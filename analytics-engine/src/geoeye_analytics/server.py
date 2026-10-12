"""JSON-lines request/response server over stdio.

One request per line: {"id": str, "method": str, "params": {...}}
One response per line: {"id": str, "result": ...} | {"id": str, "error": {"message": str, "type": str}}
"""
from __future__ import annotations

import json
import sys
import traceback
from collections.abc import Callable, Mapping
from dataclasses import asdict, is_dataclass
from typing import Any, TextIO

from . import __version__
from . import declustering, topcut, variography
from .distribution import DistributionEngine
from .multivariate import MultivariateEngine
from .providers import provider_catalog

Handler = Callable[[Mapping[str, Any]], Any]


def _plain(value: Any) -> Any:
    if is_dataclass(value) and not isinstance(value, type):
        return asdict(value)
    if hasattr(value, "to_dict"):
        return value.to_dict()
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    if isinstance(value, Mapping):
        return {str(key): _plain(item) for key, item in value.items()}
    if hasattr(value, "tolist"):
        return value.tolist()
    if hasattr(value, "item"):
        return value.item()
    return value


def build_handlers(gslib_directory: str | None = None) -> dict[str, Handler]:
    distribution = DistributionEngine()
    multivariate = MultivariateEngine()
    return {
        "engine.info": lambda _p: {
            "version": __version__,
            "python": sys.version.split()[0],
            "distribution": distribution.algorithm_version,
            "multivariate": multivariate.algorithm_version,
        },
        "engine.providers": lambda _p: provider_catalog(gslib_directory),
        "distribution.summary": lambda p: distribution.weightedSummary(p["values"], p["weights"])
        if p.get("weights") is not None
        else distribution.summary(p["values"]),
        "distribution.ecdf": lambda p: distribution.weightedEcdf(p["values"], p["weights"], p.get("observationIds"))
        if p.get("weights") is not None
        else distribution.ecdf(p["values"], p.get("observationIds")),
        "distribution.probabilityPlot": lambda p: distribution.probabilityPlot(
            p["values"], p.get("weights"), p.get("observationIds")
        ),
        "distribution.bootstrap": lambda p: distribution.bootstrap(
            p["values"],
            method=p["method"],
            weights=p.get("weights"),
            group_ids=p.get("groupIds"),
            coordinates=p.get("coordinates"),
            block_size=p.get("blockSize"),
            iterations=int(p.get("iterations", 1000)),
            seed=int(p.get("seed", 0)),
        ),
        "distribution.diagnostics": lambda p: distribution.diagnostics(p["values"], p.get("weights")),
        "decluster.optimise": lambda p: declustering.optimise(
            p["values"],
            p["coordinates"],
            minimum=float(p["minimum"]),
            maximum=float(p["maximum"]),
            count=int(p.get("count", 20)),
            anisotropy=tuple(p.get("anisotropy", (1.0, 1.0, 1.0))),
            target=p.get("target", "minimum"),
            offsets=int(p.get("offsets", 4)),
        ),
        "topcut.analyse": lambda p: topcut.analyse(
            p["values"],
            p.get("weights"),
            percentiles=tuple(p.get("percentiles", topcut.DEFAULT_PERCENTILES)),
            custom_cutoffs=tuple(p.get("customCutoffs", ())),
        ),
        "variography.normalScores": lambda p: variography.normal_scores(p["values"], p.get("weights")),
        "variography.experimental": lambda p: variography.experimental(
            p["coordinates"],
            p["values"],
            lag=float(p["lag"]),
            lag_count=int(p["lagCount"]),
            lag_tolerance=p.get("lagTolerance"),
            direction=None if p.get("direction") is None else variography.Direction(
                float(p["direction"]["azimuth"]),
                float(p["direction"]["dip"]),
                float(p["direction"].get("azimuthTolerance", 22.5)),
                float(p["direction"].get("dipTolerance", 22.5)),
                float(p["direction"].get("bandwidth", float("inf"))),
            ),
            hole_ids=p.get("holeIds"),
            downhole=bool(p.get("downhole", False)),
        ),
        "variography.fan": lambda p: variography.fan(
            p["coordinates"],
            p["values"],
            plane=p.get("plane", "horizontal"),
            lag=float(p["lag"]),
            lag_count=int(p["lagCount"]),
            rays=int(p.get("rays", 18)),
            tolerance=float(p.get("tolerance", 10.0)),
            plane_azimuth=float(p.get("planeAzimuth", 0.0)),
            plane_dip=float(p.get("planeDip", 0.0)),
        ),
        "variography.autoFit": lambda p: variography.auto_fit(
            p["experiments"],
            structure_types=tuple(p.get("structureTypes", ("spherical", "spherical"))),
            total_sill=p.get("totalSill"),
            fix_nugget=p.get("fixNugget"),
            max_lag_fraction=float(p.get("maxLagFraction", 1.0)),
        ),
        "variography.modelCurve": lambda p: variography.model_curve(
            float(p["nugget"]), p["structures"], p["h"], int(p.get("directionIndex", 0))
        ),
        "multivariate.run": lambda p: multivariate.run(
            p["rows"],
            p["variables"],
            observation_id_column=p.get("observationIdColumn", "observation_id"),
            source_ids_column=p.get("sourceIdsColumn", "source_observation_ids"),
            group_column=p.get("groupColumn"),
            correlation=p.get("correlation", "pearson"),
            missing=p.get("missing", "complete-case"),
            scaling=p.get("scaling", "standard"),
            cluster_count=int(p.get("clusterCount", 3)),
            random_seed=int(p.get("randomSeed", 20261001)),
        ),
    }


def handle(line: str, handlers: Mapping[str, Handler]) -> dict[str, Any]:
    request_id: Any = None
    try:
        request = json.loads(line)
        request_id = request.get("id")
        method = request.get("method")
        handler = handlers.get(method)
        if handler is None:
            raise KeyError(f"Unknown method: {method}")
        return {"id": request_id, "result": _plain(handler(request.get("params") or {}))}
    except Exception as error:  # noqa: BLE001 — every failure must reach the caller
        return {
            "id": request_id,
            "error": {"type": type(error).__name__, "message": str(error), "trace": traceback.format_exc(limit=4)},
        }


def serve(stdin: TextIO = sys.stdin, stdout: TextIO = sys.stdout, gslib_directory: str | None = None) -> int:
    handlers = build_handlers(gslib_directory)
    stdout.write(json.dumps({"id": None, "ready": True, "version": __version__}) + "\n")
    stdout.flush()
    for line in stdin:
        if not line.strip():
            continue
        stdout.write(json.dumps(handle(line, handlers), allow_nan=False) + "\n")
        stdout.flush()
    return 0
