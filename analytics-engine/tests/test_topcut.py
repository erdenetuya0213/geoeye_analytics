import numpy as np
import pytest

from geoeye_analytics import topcut


def test_scenario_statistics():
    v = np.array([1.0, 1.0, 1.0, 1.0, 100.0])
    w = np.ones(5)
    s = topcut.scenario(v, w, 10.0)
    assert s["cappedCount"] == 1
    assert s["mean"] == pytest.approx(14 / 5)
    assert s["metalRemovedPercent"] == pytest.approx(90 / 104 * 100)


def test_analyse_shape_and_monotonic_mean():
    rng = np.random.default_rng(1)
    v = rng.lognormal(0, 1.2, 2000)
    r = topcut.analyse(v, percentiles=(95, 99), custom_cutoffs=(5.0,))
    labels = [s["label"] for s in r["scenarios"]]
    assert labels == ["P95", "P99", "custom"]
    assert r["scenarios"][0]["mean"] <= r["scenarios"][1]["mean"] <= r["naiveMean"]
    assert len(r["logProbability"]) <= 400 and r["logProbability"][0]["probability"] < r["logProbability"][-1]["probability"]
    assert set(r["deciles"]) == {str(d) for d in range(10, 100, 10)}


def test_weighted_quantile_respects_weights():
    v = np.array([1.0, 2.0, 3.0])
    assert topcut._weighted_quantile(v, np.array([1.0, 1.0, 100.0]), 0.5) == pytest.approx(3.0, abs=0.05)
