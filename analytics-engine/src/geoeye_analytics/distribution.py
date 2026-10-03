from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal, Sequence

import numpy as np
import polars as pl
from scipy.stats import norm

BootstrapMethod = Literal["hole", "group", "spatial"]


class InvalidWeightsError(ValueError):
    """Raised when weights cannot define a representative distribution."""


@dataclass(frozen=True)
class DistributionSummary:
    count: int
    effective_count: float
    weight_sum: float
    mean: float
    variance: float
    standard_deviation: float
    minimum: float
    q1: float
    median: float
    q3: float
    p95: float
    maximum: float

    def to_dict(self) -> dict[str, float | int]:
        return asdict(self)


@dataclass(frozen=True)
class DistributionPoint:
    observation_id: str
    value: float
    probability: float
    weight: float

    def to_dict(self) -> dict[str, str | float]:
        return asdict(self)


@dataclass(frozen=True)
class BootstrapInterval:
    estimate: float
    lower: float
    upper: float

    def to_dict(self) -> dict[str, float]:
        return asdict(self)


@dataclass(frozen=True)
class BootstrapResult:
    method: BootstrapMethod
    iterations: int
    seed: int
    resampling_units: int
    statistics: dict[str, BootstrapInterval]

    def to_dict(self) -> dict[str, object]:
        return {
            "method": self.method,
            "iterations": self.iterations,
            "seed": self.seed,
            "resampling_units": self.resampling_units,
            "statistics": {key: value.to_dict() for key, value in self.statistics.items()},
        }


class DistributionEngine:
    """Deterministic distribution statistics for raw and representative samples.

    NumPy owns the numerical kernels, SciPy supplies the normal-score transform,
    and Polars owns tabular validation. Optional mining libraries are validation
    references and are deliberately absent from this compute path.
    """

    algorithm_version = "geoeye-distribution-1.0.0"
    weighted_variance_estimator = "frequency-unbiased"
    weighted_plotting_position = "centered-cumulative-weight"

    @staticmethod
    def _values(values: Sequence[float]) -> np.ndarray:
        frame = pl.DataFrame({"value": values}, strict=False)
        if frame.height == 0:
            raise ValueError("At least one finite value is required")
        array = frame.get_column("value").cast(pl.Float64).to_numpy()
        if not np.all(np.isfinite(array)):
            raise ValueError("Distribution values must be finite")
        return np.asarray(array, dtype=np.float64)

    @staticmethod
    def _weights(weights: Sequence[float], count: int) -> np.ndarray:
        if len(weights) != count:
            raise InvalidWeightsError("Weights must have the same length as values")
        frame = pl.DataFrame({"weight": weights}, strict=False)
        array = frame.get_column("weight").cast(pl.Float64).to_numpy()
        if not np.all(np.isfinite(array)):
            raise InvalidWeightsError("Weights must be finite")
        if np.any(array < 0):
            raise InvalidWeightsError("Weights must be non-negative")
        if float(np.sum(array)) <= 0:
            raise InvalidWeightsError("At least one weight must be above zero")
        return np.asarray(array, dtype=np.float64)

    @staticmethod
    def _ids(observation_ids: Sequence[str] | None, count: int) -> np.ndarray:
        if observation_ids is None:
            return np.asarray([str(index) for index in range(count)], dtype=object)
        if len(observation_ids) != count or any(not value for value in observation_ids):
            raise ValueError("Observation IDs must be non-empty and align with values")
        return np.asarray(observation_ids, dtype=object)

    @staticmethod
    def _weighted_quantile(sorted_values: np.ndarray, sorted_weights: np.ndarray, probability: float) -> float:
        bounded = float(np.clip(probability, 0, 1))
        if sorted_values.size == 1:
            return float(sorted_values[0])
        total = float(np.sum(sorted_weights))
        positions = (np.cumsum(sorted_weights) - 0.5 * sorted_weights) / total
        return float(np.interp(bounded, positions, sorted_values, left=sorted_values[0], right=sorted_values[-1]))

    def summary(self, values: Sequence[float]) -> DistributionSummary:
        array = self._values(values)
        return self.weightedSummary(array, np.ones(array.size, dtype=np.float64))

    def weightedSummary(self, values: Sequence[float], weights: Sequence[float]) -> DistributionSummary:
        array = self._values(values)
        weight_array = self._weights(weights, array.size)
        order = np.argsort(array, kind="stable")
        sorted_values = array[order]
        sorted_weights = weight_array[order]
        weight_sum = float(np.sum(sorted_weights))
        weight_square_sum = float(np.sum(np.square(sorted_weights)))
        mean = float(np.average(sorted_values, weights=sorted_weights))
        numerator = float(np.sum(sorted_weights * np.square(sorted_values - mean)))
        denominator = weight_sum - weight_square_sum / weight_sum
        variance = numerator / denominator if denominator > 0 else 0.0
        effective_count = weight_sum**2 / weight_square_sum
        return DistributionSummary(
            count=int(sorted_values.size),
            effective_count=effective_count,
            weight_sum=weight_sum,
            mean=mean,
            variance=variance,
            standard_deviation=float(np.sqrt(variance)),
            minimum=float(sorted_values[0]),
            q1=self._weighted_quantile(sorted_values, sorted_weights, 0.25),
            median=self._weighted_quantile(sorted_values, sorted_weights, 0.5),
            q3=self._weighted_quantile(sorted_values, sorted_weights, 0.75),
            p95=self._weighted_quantile(sorted_values, sorted_weights, 0.95),
            maximum=float(sorted_values[-1]),
        )

    def ecdf(
        self,
        values: Sequence[float],
        observation_ids: Sequence[str] | None = None,
    ) -> tuple[DistributionPoint, ...]:
        array = self._values(values)
        return self.weightedEcdf(array, np.ones(array.size), observation_ids)

    def weightedEcdf(
        self,
        values: Sequence[float],
        weights: Sequence[float],
        observation_ids: Sequence[str] | None = None,
    ) -> tuple[DistributionPoint, ...]:
        array = self._values(values)
        weight_array = self._weights(weights, array.size)
        ids = self._ids(observation_ids, array.size)
        order = np.argsort(array, kind="stable")
        sorted_weights = weight_array[order]
        probabilities = np.cumsum(sorted_weights) / np.sum(sorted_weights)
        return tuple(
            DistributionPoint(
                observation_id=str(ids[index]),
                value=float(array[index]),
                probability=float(probabilities[position]),
                weight=float(weight_array[index]),
            )
            for position, index in enumerate(order)
        )

    def probabilityPlot(
        self,
        values: Sequence[float],
        weights: Sequence[float] | None = None,
        observation_ids: Sequence[str] | None = None,
    ) -> tuple[dict[str, str | float], ...]:
        array = self._values(values)
        weight_array = np.ones(array.size) if weights is None else self._weights(weights, array.size)
        ids = self._ids(observation_ids, array.size)
        order = np.argsort(array, kind="stable")
        sorted_weights = weight_array[order]
        positions = (np.cumsum(sorted_weights) - 0.5 * sorted_weights) / np.sum(sorted_weights)
        normal_scores = norm.ppf(np.clip(positions, np.finfo(float).eps, 1 - np.finfo(float).eps))
        return tuple(
            {
                "observation_id": str(ids[index]),
                "value": float(array[index]),
                "probability": float(positions[position]),
                "expected_quantile": float(normal_scores[position]),
                "weight": float(weight_array[index]),
            }
            for position, index in enumerate(order)
        )

    def bootstrap(
        self,
        values: Sequence[float],
        *,
        method: BootstrapMethod,
        weights: Sequence[float] | None = None,
        group_ids: Sequence[str] | None = None,
        coordinates: Sequence[Sequence[float]] | None = None,
        block_size: float | None = None,
        iterations: int = 1000,
        seed: int = 0,
    ) -> BootstrapResult:
        array = self._values(values)
        weight_array = np.ones(array.size) if weights is None else self._weights(weights, array.size)
        if iterations < 2:
            raise ValueError("Bootstrap requires at least two iterations")
        if method in {"hole", "group"}:
            if group_ids is None or len(group_ids) != array.size:
                raise ValueError(f"{method} bootstrap requires one group ID per value")
            units: list[object] = list(group_ids)
        elif method == "spatial":
            if coordinates is None or len(coordinates) != array.size:
                raise ValueError("Spatial bootstrap requires coordinates for every value")
            if block_size is None or not np.isfinite(block_size) or block_size <= 0:
                raise ValueError("Spatial bootstrap requires a finite block size above zero")
            coordinate_array = np.asarray(coordinates, dtype=np.float64)
            if coordinate_array.ndim != 2 or coordinate_array.shape[1] not in {2, 3} or not np.all(np.isfinite(coordinate_array)):
                raise ValueError("Spatial coordinates must be finite 2D or 3D points")
            units = [tuple(row) for row in np.floor(coordinate_array / block_size).astype(int)]
        else:
            raise ValueError(f"Unsupported bootstrap method: {method}")

        unit_keys = list(dict.fromkeys(units))
        if len(unit_keys) < 2:
            raise ValueError("Grouped bootstrap requires at least two resampling units")
        indices_by_unit = {
            key: np.asarray([index for index, item in enumerate(units) if item == key], dtype=int)
            for key in unit_keys
        }
        rng = np.random.default_rng(seed)
        estimates: dict[str, list[float]] = {"mean": [], "median": [], "p95": []}
        for _ in range(iterations):
            sampled_keys = [unit_keys[index] for index in rng.integers(0, len(unit_keys), size=len(unit_keys))]
            sampled_indices = np.concatenate([indices_by_unit[key] for key in sampled_keys])
            result = self.weightedSummary(array[sampled_indices], weight_array[sampled_indices])
            estimates["mean"].append(result.mean)
            estimates["median"].append(result.median)
            estimates["p95"].append(result.p95)

        central = self.weightedSummary(array, weight_array)
        central_values = {"mean": central.mean, "median": central.median, "p95": central.p95}
        intervals = {
            key: BootstrapInterval(
                estimate=central_values[key],
                lower=float(np.quantile(replicates, 0.025)),
                upper=float(np.quantile(replicates, 0.975)),
            )
            for key, replicates in estimates.items()
        }
        return BootstrapResult(
            method=method,
            iterations=iterations,
            seed=seed,
            resampling_units=len(unit_keys),
            statistics=intervals,
        )

    def diagnostics(self, values: Sequence[float], weights: Sequence[float] | None = None) -> dict[str, object]:
        array = self._values(values)
        weight_array = np.ones(array.size) if weights is None else self._weights(weights, array.size)
        points = self.probabilityPlot(array, weight_array)
        expected = np.asarray([float(point["expected_quantile"]) for point in points])
        observed = np.asarray([float(point["value"]) for point in points])
        correlation = float(np.corrcoef(expected, observed)[0, 1]) if array.size > 1 else 1.0
        summary = self.weightedSummary(array, weight_array)
        return {
            "algorithm_version": self.algorithm_version,
            "effective_count": summary.effective_count,
            "normal_probability_r_squared": correlation**2,
            "normal_probability_r_squared_role": "secondary diagnostic; not probability or confidence",
            "weighted_plotting_position": self.weighted_plotting_position,
            "weighted_variance_estimator": self.weighted_variance_estimator,
        }
