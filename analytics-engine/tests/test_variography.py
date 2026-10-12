import numpy as np
import pytest

from geoeye_analytics import variography as vg


def _field(seed=0, n=1200, a=40.0):
    rng = np.random.default_rng(seed)
    xyz = np.column_stack([rng.uniform(0, 200, n), rng.uniform(0, 200, n), np.zeros(n)])
    d = np.linalg.norm(xyz[:, None] - xyz[None], axis=2)
    L = np.linalg.cholesky(1 - vg._structure("spherical", d, a) + 1e-6 * np.eye(n))
    return xyz, L @ rng.standard_normal(n)


def test_normal_scores_standard_and_invertible():
    v = np.random.default_rng(1).lognormal(0, 1, 500)
    r = vg.normal_scores(v)
    s = np.asarray(r["scores"])
    assert abs(s.mean()) < 0.05 and abs(s.std() - 1) < 0.05
    np.testing.assert_allclose(vg.back_transform(s, r["table"]), v, rtol=1e-6)


def test_ties_share_a_score():
    r = vg.normal_scores([1, 2, 2, 3])
    assert r["scores"][1] == r["scores"][2]


def test_experimental_recovers_sill_and_range():
    xyz, z = _field()
    e = vg.experimental(xyz, z, lag=8, lag_count=12)
    g = [l["gamma"] for l in e["lags"]]
    assert g[0] < 0.4 and 0.75 < np.mean(g[-4:]) < 1.3
    fit = vg.auto_fit([e], structure_types=("spherical",))
    assert 25 < fit["structures"][0]["ranges"][0] < 60
    assert fit["nugget"] < 0.25


def test_downhole_only_pairs_within_hole():
    xyz = np.array([[0, 0, 0], [0, 0, 1], [0, 0, 2], [5, 0, 0], [5, 0, 1]], dtype=float)
    v = np.array([1.0, 2.0, 3.0, 10.0, 20.0])
    e = vg.experimental(xyz, v, lag=1, lag_count=2, hole_ids=["A", "A", "A", "B", "B"], downhole=True)
    assert [l["pairs"] for l in e["lags"]] == [3, 1]
    assert e["lags"][0]["gamma"] == pytest.approx(0.5 * (1 + 1 + 100) / 3)


def test_directional_tolerance_filters_pairs():
    xyz = np.array([[0, 0, 0], [10, 0, 0], [0, 10, 0]], dtype=float)
    v = np.array([0.0, 1.0, 5.0])
    east = vg.experimental(xyz, v, lag=10, lag_count=1, direction=vg.Direction(90, 0, 10, 10))
    assert east["lags"][0]["pairs"] == 1 and east["lags"][0]["gamma"] == 0.5


def test_fan_returns_rays():
    xyz, z = _field(n=300)
    f = vg.fan(xyz, z, plane="horizontal", lag=15, lag_count=6, rays=6)
    assert len(f["rays"]) == 6 and f["rays"][0]["azimuth"] == 0
