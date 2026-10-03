from __future__ import annotations

from importlib import import_module
from typing import Any

from .base import (
    ProviderDescriptor,
    ProviderUnavailableError,
    SpatialColumns,
    installed_version,
    module_is_available,
)


class PygeostatProvider:
    """Adapter for pygeostat's spatial DataFile workflow container."""

    provider_id = "pygeostat"

    def describe(self) -> ProviderDescriptor:
        available = module_is_available("pygeostat")
        return ProviderDescriptor(
            provider_id="pygeostat",
            display_name="pygeostat",
            role="workflow",
            availability="available" if available else "missing",
            detail=(
                "Spatial DataFile workflow adapter is ready."
                if available
                else "Install the analytics-engine workflow extra to enable DataFile adaptation."
            ),
            version=installed_version("pygeostat"),
        )

    def to_data_file(self, frame: Any, columns: SpatialColumns) -> Any:
        """Wrap a pandas-like table in pygeostat.DataFile without copying policy into the UI."""

        try:
            pygeostat = import_module("pygeostat")
        except ImportError as error:
            raise ProviderUnavailableError(
                "pygeostat is not installed; install geoeye-analytics-engine[workflow]"
            ) from error

        keyword_arguments: dict[str, Any] = {"data": frame}
        optional_bindings = {
            "x": columns.x,
            "y": columns.y,
            "z": columns.z,
            "dh": columns.drillhole,
            "ifrom": columns.interval_from,
            "ito": columns.interval_to,
            "null": columns.null_value,
        }
        keyword_arguments.update(
            {name: value for name, value in optional_bindings.items() if value is not None}
        )
        if columns.variables:
            keyword_arguments["variables"] = list(columns.variables)
        return pygeostat.DataFile(**keyword_arguments)

