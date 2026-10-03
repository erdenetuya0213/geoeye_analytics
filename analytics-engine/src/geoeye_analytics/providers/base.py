from __future__ import annotations

from dataclasses import asdict, dataclass
from importlib import metadata, util
from typing import Literal

ProviderId = Literal["geoeye-native", "pygeostat", "geostatspy", "gslib"]
ProviderRole = Literal[
    "compute",
    "workflow",
    "implementation-reference",
    "behavior-reference",
]
Availability = Literal["available", "missing", "not-configured"]


class ProviderUnavailableError(RuntimeError):
    """Raised when an optional analytics provider cannot be used."""


@dataclass(frozen=True)
class ProviderDescriptor:
    provider_id: ProviderId
    display_name: str
    role: ProviderRole
    availability: Availability
    detail: str
    version: str | None = None

    def to_dict(self) -> dict[str, str | None]:
        return asdict(self)


@dataclass(frozen=True)
class SpatialColumns:
    """Column bindings used when adapting a table to a geostatistical library."""

    x: str | None = None
    y: str | None = None
    z: str | None = None
    drillhole: str | None = None
    interval_from: str | None = None
    interval_to: str | None = None
    variables: tuple[str, ...] = ()
    null_value: float | None = None


def installed_version(distribution_name: str) -> str | None:
    try:
        return metadata.version(distribution_name)
    except metadata.PackageNotFoundError:
        return None


def module_is_available(module_name: str) -> bool:
    try:
        return util.find_spec(module_name) is not None
    except (ImportError, ModuleNotFoundError, ValueError):
        return False

