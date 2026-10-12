"""Top-cut (capping) analysis: candidate cut-offs with metal-at-risk statistics."""
from __future__ import annotations

from collections.abc import Sequence

import numpy as np
from scipy.stats import norm

DEFAULT_PERCENTILES = (95.0, 97.5, 98.0, 99.0, 99.5, 99.9)


def _arrays(values: Sequence[float], weights: Sequence[float] | None) -> tuple[np.ndarray, np.ndarray]:
    v = np.asarray(values, dtype=np.float64)
    if v.ndim != 1 or v.size < 2 or not np.all(np.isfinite(v)):
        raise ValueError("Values must be a finite 1-D array with at least two entries")
    w = np.ones(v.size) if weights is None else np.asarray(weights, dtype=np.float64)
    if w.shape != v.shape or np.any(w < 0) or w.sum() <= 0:
        raise ValueError("Weights must be non-negative, same length as values, and not all zero")
    return v, w


def _weighted_quantile(v: np.ndarray, w: np.ndarray, p: float) -> float:
    order = np.argsort(v, kind="stable")
    sv, sw = v[order], w[order]
    cumulative = (np.cumsum(sw) - 0.5 * sw) / sw.sum()
    return float(np.interp(p, cumulative, sv))


def _stats(v: np.ndarray, w: np.ndarray) -> tuple[float, float]:
    mean = float(np.average(v, weights=w))
    var = float(np.average((v - mean) ** 2, weights=w))
    return mean, (var**0.5 / mean if mean > 0 else float("nan"))


def scenario(v: np.ndarray, w: np.ndarray, cut: float) -> dict[str, float | int]:
    capped = np.minimum(v, cut)
    mean, cv = _stats(capped, w)
    naive_mean, _ = _stats(v, w)
    metal = float((v * w).sum())
    lost = float(((v - capped) * w).sum())
    return {
        "cutOff": float(cut),
        "cappedCount": int((v > cut).sum()),
        "cappedPercent": float((w[v > cut].sum() / w.sum()) * 100.0),
        "mean": mean,
        "meanChangePercent": float((mean / naive_mean - 1.0) * 100.0) if naive_mean > 0 else float("nan"),
        "cv": cv,
        "metalRemovedPercent": float(lost / metal * 100.0) if metal > 0 else 0.0,
    }


def analyse(
    values: Sequence[float],
    weights: Sequence[float] | None = None,
    *,
    percentiles: Sequence[float] = DEFAULT_PERCENTILES,
    custom_cutoffs: Sequence[float] = (),
    plot_points: int = 400,
) -> dict[str, object]:
    v, w = _arrays(values, weights)
    naive_mean, naive_cv = _stats(v, w)
    cuts = [(f"P{p:g}", _weighted_quantile(v, w, p / 100.0)) for p in percentiles]
    cuts += [("custom", float(c)) for c in custom_cutoffs]
    scenarios = [{"label": label, **scenario(v, w, cut)} for label, cut in cuts]

    # Log-probability plot (weighted), thinned for transport.
    order = np.argsort(v, kind="stable")
    sv, sw = v[order], w[order]
    cumulative = (np.cumsum(sw) - 0.5 * sw) / sw.sum()
    positive = sv > 0
    idx = np.unique(np.linspace(0, positive.sum() - 1, min(plot_points, int(positive.sum()))).astype(int)) if positive.any() else np.array([], dtype=int)
    plot = [
        {"value": float(sv[positive][i]), "probability": float(cumulative[positive][i]), "z": float(norm.ppf(cumulative[positive][i]))}
        for i in idx
    ]
    deciles = {f"{d}": _weighted_quantile(v, w, d / 100.0) for d in range(10, 100, 10)}

    # Mean-and-CV curve across a fine grid of cut-offs on the upper tail (for the "disintegration" view).
    grid = np.unique(np.quantile(sv, np.linspace(0.90, 1.0, 41)))
    curve = [{"cutOff": float(c), "mean": s["mean"], "cv": s["cv"], "metalRemovedPercent": s["metalRemovedPercent"]} for c in grid for s in [scenario(v, w, float(c))]]

    return {
        "algorithm_version": "geoeye-topcut-1.0.0",
        "count": int(v.size),
        "effectiveCount": float(w.sum() ** 2 / (w**2).sum()),
        "naiveMean": naive_mean,
        "naiveCv": naive_cv,
        "maximum": float(v.max()),
        "scenarios": scenarios,
        "curve": curve,
        "logProbability": plot,
        "deciles": deciles,
    }
