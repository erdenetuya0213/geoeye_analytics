"""Experimental variograms, normal-scores transform, and nested model fitting.

Conventions: azimuth clockwise from north (grid Y), dip positive downwards,
GSLIB-style lag/angle/bandwidth tolerances. Pair search is vectorised in
chunks so tens of thousands of samples stay in memory.
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from scipy.optimize import least_squares
from scipy.stats import norm, rankdata

# ---------------------------------------------------------------- transform


def normal_scores(values: Sequence[float], weights: Sequence[float] | None = None) -> dict[str, object]:
    v = np.asarray(values, dtype=np.float64)
    w = np.ones(v.size) if weights is None else np.asarray(weights, dtype=np.float64)
    order = np.argsort(v, kind="stable")
    cum = np.empty(v.size)
    cum[order] = (np.cumsum(w[order]) - 0.5 * w[order]) / w.sum()
    ranks = rankdata(v, method="average")  # ties share one plotting position
    uniq, inverse = np.unique(ranks, return_inverse=True)
    cum = np.bincount(inverse, weights=cum)[inverse] / np.bincount(inverse)[inverse]
    scores = norm.ppf(np.clip(cum, 1e-6, 1 - 1e-6))
    table = np.column_stack([v[order], scores[order]])
    return {"scores": scores.tolist(), "table": table.tolist()}


def back_transform(scores: Sequence[float], table: Sequence[Sequence[float]]) -> list[float]:
    t = np.asarray(table, dtype=np.float64)
    return np.interp(np.asarray(scores, dtype=np.float64), t[:, 1], t[:, 0]).tolist()


# ------------------------------------------------------------ experimental


def direction_vector(azimuth: float, dip: float) -> np.ndarray:
    a, d = np.radians(azimuth), np.radians(dip)
    return np.array([np.sin(a) * np.cos(d), np.cos(a) * np.cos(d), -np.sin(d)])


@dataclass(frozen=True)
class Direction:
    azimuth: float
    dip: float
    azimuth_tolerance: float = 22.5
    dip_tolerance: float = 22.5
    bandwidth: float = np.inf


def experimental(
    coordinates: Sequence[Sequence[float]],
    values: Sequence[float],
    *,
    lag: float,
    lag_count: int,
    lag_tolerance: float | None = None,
    direction: Direction | None = None,
    hole_ids: Sequence[str] | None = None,
    downhole: bool = False,
    chunk: int = 2000,
) -> dict[str, object]:
    xyz = np.asarray(coordinates, dtype=np.float64)
    v = np.asarray(values, dtype=np.float64)
    if xyz.ndim != 2 or xyz.shape[1] != 3 or xyz.shape[0] != v.size:
        raise ValueError("coordinates must be (n, 3) and match values")
    if lag <= 0 or lag_count < 1:
        raise ValueError("lag must be positive and lag_count >= 1")
    tol = lag / 2 if lag_tolerance is None else lag_tolerance
    holes = None if hole_ids is None else np.asarray(hole_ids)
    if downhole and holes is None:
        raise ValueError("downhole variogram needs hole_ids")
    u = None if direction is None else direction_vector(direction.azimuth, direction.dip)

    n = v.size
    gamma_sum, dist_sum = np.zeros(lag_count), np.zeros(lag_count)
    counts = np.zeros(lag_count, dtype=np.int64)
    max_dist = lag * lag_count + tol

    for start in range(0, n, chunk):
        i = np.arange(start, min(start + chunk, n))
        d = xyz[None, :, :] - xyz[i, None, :]
        dist = np.linalg.norm(d, axis=2)
        mask = (dist > 0) & (dist <= max_dist) & (np.arange(n)[None, :] > i[:, None])
        if downhole:
            mask &= holes[None, :] == holes[i, None]
        elif u is not None and direction is not None:
            along = np.abs(d @ u)
            horiz = np.linalg.norm(d[:, :, :2], axis=2)
            uh = u[:2] / max(np.linalg.norm(u[:2]), 1e-9)
            cos_az = np.divide(np.abs(d[:, :, :2] @ uh), horiz, out=np.ones_like(dist), where=horiz > 1e-9)
            az_ok = cos_az >= np.cos(np.radians(direction.azimuth_tolerance))
            dip_pair = np.degrees(np.arctan2(np.abs(d[:, :, 2]), np.maximum(horiz, 1e-9)))
            dip_ok = np.abs(dip_pair - abs(direction.dip)) <= direction.dip_tolerance
            perp = np.sqrt(np.clip(dist**2 - along**2, 0, None))
            mask &= az_ok & dip_ok & (perp <= direction.bandwidth)
        if not mask.any():
            continue
        dd = dist[mask]
        bins = np.rint(dd / lag).astype(np.int64) - 1
        within = (bins >= 0) & (bins < lag_count) & (np.abs(dd - (bins + 1) * lag) <= tol)
        g = (0.5 * (v[None, :] - v[i, None]) ** 2)[mask][within]
        b = bins[within]
        gamma_sum += np.bincount(b, weights=g, minlength=lag_count)
        counts += np.bincount(b, minlength=lag_count)
        dist_sum += np.bincount(b, weights=dd[within], minlength=lag_count)

    return {
        "lags": [{"distance": float(dist_sum[k] / counts[k]), "gamma": float(gamma_sum[k] / counts[k]), "pairs": int(counts[k])} for k in range(lag_count) if counts[k] > 0],
        "variance": float(v.var()),
        "count": int(n),
    }


def fan(
    coordinates: Sequence[Sequence[float]],
    values: Sequence[float],
    *,
    plane: str,
    lag: float,
    lag_count: int,
    rays: int = 18,
    tolerance: float = 10.0,
    plane_azimuth: float = 0.0,
    plane_dip: float = 0.0,
) -> dict[str, object]:
    """Continuity fan: rays every 180/rays degrees in a plane.

    plane: 'horizontal' (angle = azimuth), 'across' (vertical plane striking plane_azimuth; angle = dip),
    'dip' (plane with strike plane_azimuth, dip plane_dip; angle from strike towards dip).
    """
    out = []
    for k in range(rays):
        theta = 180.0 * k / rays
        if plane == "horizontal":
            direction = Direction(theta, 0.0, tolerance, tolerance)
        else:
            strike = direction_vector(plane_azimuth, 0.0)
            down = direction_vector(plane_azimuth + 90.0, 90.0 if plane == "across" else plane_dip)
            vec = np.cos(np.radians(theta)) * strike + np.sin(np.radians(theta)) * down
            az = float(np.degrees(np.arctan2(vec[0], vec[1])) % 360)
            dip = float(np.degrees(np.arcsin(np.clip(-vec[2], -1, 1))))
            direction = Direction(az, dip, tolerance, tolerance)
        result = experimental(coordinates, values, lag=lag, lag_count=lag_count, direction=direction)
        out.append({"angle": theta, "azimuth": direction.azimuth, "dip": direction.dip, "lags": result["lags"]})
    return {"rays": out, "plane": plane}


# ----------------------------------------------------------------- models


def _structure(kind: str, h: np.ndarray, a: float | np.ndarray) -> np.ndarray:
    r = np.clip(h / np.maximum(a, 1e-9), 0, None)
    if kind == "spherical":
        return np.where(r < 1, 1.5 * r - 0.5 * r**3, 1.0)
    if kind == "exponential":
        return 1 - np.exp(-3 * r)
    if kind == "gaussian":
        return 1 - np.exp(-3 * r**2)
    raise ValueError(f"Unknown structure: {kind}")


def model_curve(nugget: float, structures: Sequence[dict], h: Sequence[float], direction_index: int = 0) -> list[float]:
    hh = np.asarray(h, dtype=np.float64)
    g = np.full(hh.shape, float(nugget))
    for s in structures:
        g = g + s["sill"] * _structure(s["type"], hh, s["ranges"][direction_index])
    return g.tolist()


def auto_fit(
    experiments: Sequence[dict],
    *,
    structure_types: Sequence[str] = ("spherical", "spherical"),
    total_sill: float | None = None,
    fix_nugget: float | None = None,
    max_lag_fraction: float = 1.0,
) -> dict[str, object]:
    """Fit nugget + nested structures: sills shared across directions, one range per direction.

    experiments: one {"lags": [...]} per direction. Weights ∝ pairs / h².
    """
    ndir = len(experiments)
    rows = []
    for k, e in enumerate(experiments):
        lags = e["lags"]
        if not lags:
            continue
        hmax = max(l["distance"] for l in lags) * max_lag_fraction
        rows += [(l["distance"], l["gamma"], l["pairs"] / max(l["distance"], 1e-6) ** 2, k) for l in lags if l["distance"] <= hmax]
    if len(rows) < 3:
        raise ValueError("Not enough experimental points to fit")
    h, g, w, d = (np.asarray(c) for c in zip(*rows))
    d = d.astype(int)
    w = np.sqrt(w / w.max())
    sill_target = float(np.median(g[h >= np.percentile(h, 60)])) if total_sill is None else total_sill
    ns, hmax_all = len(structure_types), float(h.max())

    def unpack(p):
        nug = p[0] if fix_nugget is None else fix_nugget
        return nug, p[1:1 + ns], p[1 + ns:].reshape(ns, ndir)

    def residual(p):
        nug, sills, ranges = unpack(p)
        pred = np.full(h.shape, nug)
        for s in range(ns):
            pred = pred + sills[s] * _structure(structure_types[s], h, ranges[s][d])
        res = (pred - g) * w
        return res if total_sill is None else np.append(res, 10 * (nug + sills.sum() - total_sill))

    x0 = np.concatenate([[0.1 * sill_target], np.full(ns, 0.9 * sill_target / ns), np.repeat(np.linspace(0.3, 0.8, ns) * hmax_all, ndir)])
    lb = np.concatenate([[0.0], np.zeros(ns), np.full(ns * ndir, hmax_all * 0.02)])
    ub = np.concatenate([[sill_target * 1.5], np.full(ns, sill_target * 1.5), np.full(ns * ndir, hmax_all * 3)])
    fit = least_squares(residual, x0, bounds=(lb, ub), max_nfev=2000)
    nug, sills, ranges = unpack(fit.x)
    order = np.argsort(ranges.mean(axis=1))
    structures = [{"type": structure_types[s], "sill": float(sills[s]), "ranges": [float(r) for r in ranges[s]]} for s in order]
    return {"nugget": float(nug), "structures": structures, "totalSill": float(nug + sills.sum()), "rmse": float(np.sqrt(np.mean(fit.fun[: h.size] ** 2)))}
