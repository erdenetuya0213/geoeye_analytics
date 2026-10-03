from __future__ import annotations

import pytest

from geoeye_analytics.multivariate import MultivariateEngine


@pytest.fixture()
def rows() -> list[dict[str, object]]:
    return [
        {"observation_id": "a", "source_observation_ids": ["assay-a", "log-a"], "group": "Diorite", "au": 1.0, "cu": 2.0, "as": 8.0},
        {"observation_id": "b", "source_observation_ids": ["assay-b", "log-b"], "group": "Diorite", "au": 2.0, "cu": 4.0, "as": 6.0},
        {"observation_id": "c", "source_observation_ids": ["assay-c", "log-c"], "group": "Breccia", "au": 3.0, "cu": 6.0, "as": None},
        {"observation_id": "d", "source_observation_ids": ["assay-d", "log-d"], "group": "Breccia", "au": 4.0, "cu": 8.0, "as": 2.0},
    ]


def test_run_returns_pair_counts_scores_loadings_and_lineage(rows: list[dict[str, object]]) -> None:
    result = MultivariateEngine().run(rows, ["au", "cu", "as"], group_column="group", cluster_count=2)

    assert result["correlation"]["pearson"][0][1] == pytest.approx(1.0)
    assert result["correlation"]["counts"][0][2] == 3
    assert result["missing"]["analysis_count"] == 3
    assert len(result["pca"]["loadings"]) == 3
    assert len(result["rows"]) == 3
    assert result["rows"][0]["source_observation_ids"] == ["assay-a", "log-a"]
    assert {row["cluster"] for row in result["rows"]} <= {1, 2}
    assert {group["group"] for group in result["groups"]} == {"Breccia", "Diorite"}


def test_median_imputation_retains_rows_and_is_reproducible(rows: list[dict[str, object]]) -> None:
    options = {"group_column": "group", "cluster_count": 2, "missing": "median-impute"}
    first = MultivariateEngine().run(rows, ["au", "cu", "as"], **options)
    second = MultivariateEngine().run(rows, ["au", "cu", "as"], **options)

    assert first["missing"]["analysis_count"] == 4
    assert first["rows"] == second["rows"]
    assert first["pca"] == second["pca"]


def test_requires_two_variables(rows: list[dict[str, object]]) -> None:
    with pytest.raises(ValueError, match="at least two variables"):
        MultivariateEngine().run(rows, ["au"])
