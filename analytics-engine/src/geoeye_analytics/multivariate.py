"""Local multivariate analysis with explicit missing-data and scaling policy."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Literal

import numpy as np
import polars as pl
from scipy.stats import pearsonr, rankdata, spearmanr
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.preprocessing import RobustScaler, StandardScaler

CorrelationMethod = Literal["pearson", "spearman"]
MissingPolicy = Literal["complete-case", "median-impute"]
ScalingMethod = Literal["standard", "robust", "none"]


class MultivariateEngine:
    """GeoEye's provider-neutral local multivariate execution boundary.

    Polars validates and selects the analytical table, SciPy calculates
    pairwise correlations, NumPy owns arrays and summaries, and scikit-learn
    owns scaling, PCA, and k-means. Inputs are never mutated and every row in
    the output retains its source observation identifiers.
    """

    algorithm_version = "geoeye-multivariate-1.0.0"

    @staticmethod
    def _frame(
        rows: pl.DataFrame | Sequence[Mapping[str, Any]],
        variables: Sequence[str],
        observation_id_column: str,
    ) -> pl.DataFrame:
        frame = rows.clone() if isinstance(rows, pl.DataFrame) else pl.DataFrame(rows, strict=False)
        required = [observation_id_column, *variables]
        missing = [column for column in required if column not in frame.columns]
        if missing:
            raise ValueError(f"Missing required multivariate columns: {', '.join(missing)}")
        if len(variables) < 2:
            raise ValueError("Multivariate analysis requires at least two variables")
        if frame.height < 2:
            raise ValueError("Multivariate analysis requires at least two observations")
        if frame.get_column(observation_id_column).null_count() > 0:
            raise ValueError("Observation IDs must be non-null")
        return frame.with_columns([
            pl.col(variable).cast(pl.Float64, strict=False).fill_nan(None).alias(variable)
            for variable in variables
        ])

    @staticmethod
    def _pairwise_correlation(frame: pl.DataFrame, variables: Sequence[str]) -> dict[str, Any]:
        pearson: list[list[float | None]] = []
        spearman: list[list[float | None]] = []
        counts: list[list[int]] = []
        for left in variables:
            pearson_row: list[float | None] = []
            spearman_row: list[float | None] = []
            count_row: list[int] = []
            for right in variables:
                pair = frame.select([
                    pl.col(left).alias("_left"),
                    pl.col(right).alias("_right"),
                ]).drop_nulls()
                count = pair.height
                count_row.append(count)
                if count < 2:
                    pearson_row.append(None)
                    spearman_row.append(None)
                    continue
                left_values = pair.get_column("_left").to_numpy()
                right_values = pair.get_column("_right").to_numpy()
                if np.ptp(left_values) == 0 or np.ptp(right_values) == 0:
                    pearson_row.append(None)
                    spearman_row.append(None)
                    continue
                pearson_value = float(pearsonr(left_values, right_values).statistic)
                spearman_value = float(spearmanr(left_values, right_values).statistic)
                pearson_row.append(pearson_value if np.isfinite(pearson_value) else None)
                spearman_row.append(spearman_value if np.isfinite(spearman_value) else None)
            pearson.append(pearson_row)
            spearman.append(spearman_row)
            counts.append(count_row)
        return {"pearson": pearson, "spearman": spearman, "counts": counts}

    @staticmethod
    def _analysis_matrix(
        frame: pl.DataFrame,
        variables: Sequence[str],
        missing: MissingPolicy,
    ) -> tuple[pl.DataFrame, np.ndarray, int]:
        selected = frame.select(list(variables))
        complete_count = selected.drop_nulls().height
        if missing == "complete-case":
            usable = frame.filter(pl.all_horizontal([pl.col(variable).is_not_null() for variable in variables]))
        elif missing == "median-impute":
            medians = selected.select([pl.col(variable).median().alias(variable) for variable in variables]).row(0)
            if any(value is None for value in medians):
                raise ValueError("Median imputation requires at least one finite value for every variable")
            usable = frame.with_columns([
                pl.col(variable).fill_null(float(median)).alias(variable)
                for variable, median in zip(variables, medians, strict=True)
            ])
        else:
            raise ValueError(f"Unsupported missing-data policy: {missing}")
        matrix = usable.select(list(variables)).to_numpy().astype(np.float64, copy=False)
        if matrix.shape[0] < 2:
            raise ValueError("Fewer than two rows remain after applying the missing-data policy")
        return usable, matrix, complete_count

    @staticmethod
    def _scaled(matrix: np.ndarray, scaling: ScalingMethod) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        if scaling == "standard":
            scaler = StandardScaler()
            scaled = scaler.fit_transform(matrix)
            return scaled, np.asarray(scaler.mean_), np.asarray(scaler.scale_)
        if scaling == "robust":
            scaler = RobustScaler()
            scaled = scaler.fit_transform(matrix)
            return scaled, np.asarray(scaler.center_), np.asarray(scaler.scale_)
        if scaling == "none":
            return matrix.copy(), np.zeros(matrix.shape[1]), np.ones(matrix.shape[1])
        raise ValueError(f"Unsupported scaling method: {scaling}")

    def run(
        self,
        rows: pl.DataFrame | Sequence[Mapping[str, Any]],
        variables: Sequence[str],
        *,
        observation_id_column: str = "observation_id",
        source_ids_column: str = "source_observation_ids",
        group_column: str | None = None,
        correlation: CorrelationMethod = "pearson",
        missing: MissingPolicy = "complete-case",
        scaling: ScalingMethod = "standard",
        cluster_count: int = 3,
        random_seed: int = 20261001,
    ) -> dict[str, Any]:
        if correlation not in {"pearson", "spearman"}:
            raise ValueError(f"Unsupported correlation method: {correlation}")
        if cluster_count < 2 or cluster_count > 12:
            raise ValueError("Cluster count must be between 2 and 12")
        frame = self._frame(rows, variables, observation_id_column)
        pairwise = self._pairwise_correlation(frame, variables)
        usable, matrix, complete_count = self._analysis_matrix(frame, variables, missing)
        scaled, centers, scales = self._scaled(matrix, scaling)
        component_count = min(len(variables), scaled.shape[0])
        pca = PCA(n_components=component_count, svd_solver="full")
        scores = pca.fit_transform(scaled)
        effective_clusters = min(cluster_count, scaled.shape[0])
        kmeans = KMeans(n_clusters=effective_clusters, n_init=20, random_state=random_seed)
        memberships = kmeans.fit_predict(scaled)

        score_rows: list[dict[str, Any]] = []
        for index, row in enumerate(usable.iter_rows(named=True)):
            source_ids = row.get(source_ids_column)
            if not isinstance(source_ids, list):
                source_ids = [str(row[observation_id_column])]
            score_rows.append({
                "observation_id": str(row[observation_id_column]),
                "source_observation_ids": [str(value) for value in source_ids],
                "group": str(row[group_column]) if group_column and row.get(group_column) is not None else "All observations",
                "values": {variable: float(row[variable]) for variable in variables},
                "scores": [float(value) for value in scores[index]],
                "cluster": int(memberships[index]) + 1,
            })

        group_comparison: list[dict[str, Any]] = []
        group_labels = sorted({row["group"] for row in score_rows})
        for label in group_labels:
            indices = [index for index, row in enumerate(score_rows) if row["group"] == label]
            group_comparison.append({
                "group": label,
                "count": len(indices),
                "score_means": [float(value) for value in np.mean(scores[indices], axis=0)],
                "cluster_counts": [int(np.sum(memberships[indices] == cluster)) for cluster in range(effective_clusters)],
            })

        return {
            "algorithm_version": self.algorithm_version,
            "variables": list(variables),
            "correlation_method": correlation,
            "correlation": pairwise,
            "missing": {
                "policy": missing,
                "input_count": frame.height,
                "complete_count": complete_count,
                "analysis_count": usable.height,
                "excluded_or_imputed_count": frame.height - complete_count,
            },
            "scaling": {
                "method": scaling,
                "centers": centers.tolist(),
                "scales": scales.tolist(),
            },
            "pca": {
                "explained_variance": pca.explained_variance_.tolist(),
                "explained_variance_ratio": pca.explained_variance_ratio_.tolist(),
                "loadings": pca.components_.T.tolist(),
            },
            "clustering": {
                "requested_cluster_count": cluster_count,
                "cluster_count": effective_clusters,
                "inertia": float(kmeans.inertia_),
                "centroids_scaled": kmeans.cluster_centers_.tolist(),
            },
            "rows": score_rows,
            "groups": group_comparison,
            "provenance": {
                "engine": "GeoEye MultivariateEngine",
                "algorithm_version": self.algorithm_version,
                "random_seed": random_seed,
            },
        }
