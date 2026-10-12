import numpy as np

from geoeye_analytics import declustering


def test_single_offset_weights_follow_cell_counts():
    # Three samples in one cell, one sample alone: weights 1/3,1/3,1/3,1 scaled to sum 4.
    xyz = [[0, 0], [1, 0], [0, 1], [50, 50]]
    w, cells = declustering.cell_weights(xyz, 10.0, offsets=1)
    assert cells == 2
    np.testing.assert_allclose(w, np.array([1 / 3, 1 / 3, 1 / 3, 1.0]) * 4 / 2.0)
    assert abs(w.sum() - 4) < 1e-9


def test_clustered_high_grade_is_pulled_down():
    rng = np.random.default_rng(0)
    background = rng.uniform(0, 100, (200, 2))
    cluster = rng.uniform(40, 45, (200, 2))
    coords = np.vstack([background, cluster])
    values = np.concatenate([np.full(200, 1.0), np.full(200, 10.0)])
    result = declustering.optimise(values, coords, minimum=2, maximum=40, count=10)
    assert result["declusteredMean"] < result["naiveMean"]
    assert len(result["weights"]) == 400 and abs(sum(result["weights"]) - 400) < 1e-6
    assert result["chosen"]["mean"] == min(p["mean"] for p in result["curve"])


def test_rejects_bad_inputs():
    import pytest
    with pytest.raises(ValueError):
        declustering.sweep([1, 2], [[0, 0], [1, 1]], minimum=5, maximum=1)
    with pytest.raises(ValueError):
        declustering.cell_weights([[0, 0]], 0)
