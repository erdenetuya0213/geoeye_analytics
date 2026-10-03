from __future__ import annotations

import math

import pytest

from geoeye_analytics.distribution import DistributionEngine, InvalidWeightsError


@pytest.fixture()
def engine() -> DistributionEngine:
    return DistributionEngine()


def test_weighted_summary_and_variance(engine: DistributionEngine) -> None:
    result = engine.weightedSummary([1, 2, 10], [1, 1, 2])

    assert result.mean == pytest.approx(5.75)
    assert result.variance == pytest.approx(29.1)
    assert result.effective_count == pytest.approx(8 / 3)
    assert result.median == pytest.approx(14 / 3)


def test_weighted_ecdf_and_plotting_positions(engine: DistributionEngine) -> None:
    ecdf = engine.weightedEcdf([30, 10, 20], [2, 1, 1], ["c", "a", "b"])
    probability = engine.probabilityPlot([30, 10, 20], [2, 1, 1], ["c", "a", "b"])

    assert [(point.observation_id, point.probability) for point in ecdf] == [
        ("a", pytest.approx(0.25)),
        ("b", pytest.approx(0.5)),
        ("c", pytest.approx(1.0)),
    ]
    assert [point["probability"] for point in probability] == pytest.approx([0.125, 0.375, 0.75])
    assert all(math.isfinite(float(point["expected_quantile"])) for point in probability)


def test_weighted_quantiles_interpolate_centered_weight_positions(engine: DistributionEngine) -> None:
    result = engine.weightedSummary([1, 2, 3, 4], [1, 1, 1, 1])

    assert result.q1 == pytest.approx(1.5)
    assert result.median == pytest.approx(2.5)
    assert result.q3 == pytest.approx(3.5)


@pytest.mark.parametrize(
    "weights, message",
    [
        ([1, -1], "non-negative"),
        ([0, 0], "above zero"),
        ([1, float("nan")], "finite"),
        ([1], "same length"),
    ],
)
def test_invalid_weights(engine: DistributionEngine, weights: list[float], message: str) -> None:
    with pytest.raises(InvalidWeightsError, match=message):
        engine.weightedSummary([1, 2], weights)


def test_grouped_bootstrap_is_reproducible_and_not_row_bootstrap(engine: DistributionEngine) -> None:
    options = {
        "method": "hole",
        "group_ids": ["H1", "H1", "H2", "H2", "H3", "H3"],
        "iterations": 250,
        "seed": 42,
    }
    first = engine.bootstrap([1, 2, 4, 5, 20, 21], **options)
    second = engine.bootstrap([1, 2, 4, 5, 20, 21], **options)

    assert first == second
    assert first.resampling_units == 3
    assert first.statistics["mean"].lower < first.statistics["mean"].estimate < first.statistics["mean"].upper


def test_spatial_bootstrap_requires_blocks_and_is_reproducible(engine: DistributionEngine) -> None:
    options = {
        "method": "spatial",
        "coordinates": [(0, 0), (1, 1), (11, 1), (12, 2), (22, 1), (23, 2)],
        "block_size": 10,
        "iterations": 100,
        "seed": 7,
    }
    first = engine.bootstrap([1, 2, 4, 5, 20, 21], **options)
    second = engine.bootstrap([1, 2, 4, 5, 20, 21], **options)

    assert first == second
    assert first.resampling_units == 3


def test_diagnostics_label_r_squared_as_secondary(engine: DistributionEngine) -> None:
    diagnostics = engine.diagnostics([1, 2, 3, 4])

    assert 0 <= diagnostics["normal_probability_r_squared"] <= 1
    assert diagnostics["normal_probability_r_squared_role"] == "secondary diagnostic; not probability or confidence"
