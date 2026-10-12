"""Cell declustering (Deutsch & Journel, GSLIB `declus`).

Weights ∝ 1 / (number of samples in the sample's cell), averaged over several
grid origin offsets, normalised to sum to n. The cell-size sweep reports the
declustered mean per size so the user can pick the minimum (clustered high
grade) or maximum (clustered low grade).
"""
from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Sequence

import numpy as np

Point = Sequence[float]


@dataclass(frozen=True)
class DeclusterPoint:
    cell_size: float
    mean: float
    cell_count: int

    def to_dict(self) -> dict[str, float | int]:
        return {"cellSize": self.cell_size, "mean": self.mean, "cellCount": self.cell_count}


def _xyz(coordinates: Sequence[Point]) -> np.ndarray:
    xyz = np.asarray(coordinates, dtype=np.float64)
    if xyz.ndim != 2 or xyz.shape[1] not in (2, 3):
        raise ValueError("Coordinates must be an (n, 2) or (n, 3) array")
    if xyz.shape[1] == 2:
        xyz = np.column_stack([xyz, np.zeros(xyz.shape[0])])
    if not np.all(np.isfinite(xyz)):
        raise ValueError("Coordinates must be finite")
    return xyz


def cell_weights(
    coordinates: Sequence[Point],
    cell_size: float | Sequence[float],
    *,
    offsets: int = 4,
) -> tuple[np.ndarray, int]:
    """Return (weights summing to n, mean occupied-cell count across offsets)."""
    xyz = _xyz(coordinates)
    size = np.broadcast_to(np.asarray(cell_size, dtype=np.float64), (3,)).copy()
    if np.any(size <= 0):
        raise ValueError("Cell size must be positive")
    origin = xyz.min(axis=0)
    weights = np.zeros(xyz.shape[0])
    cells = 0
    for k in range(offsets):
        shifted = (xyz - origin + size * (k / offsets)) / size
        index = np.floor(shifted).astype(np.int64)
        _, inverse, counts = np.unique(index, axis=0, return_inverse=True, return_counts=True)
        inverse = inverse.reshape(-1)
        weights += 1.0 / counts[inverse]
        cells += counts.size
    weights *= xyz.shape[0] / weights.sum()
    return weights, round(cells / offsets)


def declustered_mean(values: Sequence[float], weights: np.ndarray) -> float:
    v = np.asarray(values, dtype=np.float64)
    return float(np.average(v, weights=weights))


def sweep(
    values: Sequence[float],
    coordinates: Sequence[Point],
    *,
    minimum: float,
    maximum: float,
    count: int = 20,
    anisotropy: Sequence[float] = (1.0, 1.0, 1.0),
    offsets: int = 4,
) -> list[DeclusterPoint]:
    if minimum <= 0 or maximum <= minimum or count < 2:
        raise ValueError("Sweep requires 0 < minimum < maximum and count >= 2")
    ratio = np.asarray(anisotropy, dtype=np.float64)
    v = np.asarray(values, dtype=np.float64)
    if v.ndim != 1 or v.size != len(coordinates):
        raise ValueError("Values and coordinates must have the same length")
    points = []
    for size in np.linspace(minimum, maximum, count):
        w, cells = cell_weights(coordinates, size * ratio, offsets=offsets)
        points.append(DeclusterPoint(float(size), declustered_mean(v, w), cells))
    return points


def optimise(
    values: Sequence[float],
    coordinates: Sequence[Point],
    *,
    minimum: float,
    maximum: float,
    count: int = 20,
    anisotropy: Sequence[float] = (1.0, 1.0, 1.0),
    target: str = "minimum",
    offsets: int = 4,
) -> dict[str, object]:
    if target not in {"minimum", "maximum"}:
        raise ValueError("target must be 'minimum' or 'maximum'")
    curve = sweep(values, coordinates, minimum=minimum, maximum=maximum, count=count, anisotropy=anisotropy, offsets=offsets)
    means = np.asarray([p.mean for p in curve])
    pick = int(np.argmin(means) if target == "minimum" else np.argmax(means))
    chosen = curve[pick]
    weights, _ = cell_weights(coordinates, chosen.cell_size * np.asarray(anisotropy, dtype=np.float64), offsets=offsets)
    v = np.asarray(values, dtype=np.float64)
    return {
        "algorithm_version": "geoeye-declus-1.0.0",
        "curve": [p.to_dict() for p in curve],
        "chosen": chosen.to_dict(),
        "naiveMean": float(v.mean()),
        "declusteredMean": chosen.mean,
        "weights": weights.tolist(),
    }
