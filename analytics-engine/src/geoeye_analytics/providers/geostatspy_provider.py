from __future__ import annotations

from importlib import import_module
from typing import Any

from .base import (
    ProviderDescriptor,
    ProviderUnavailableError,
    installed_version,
    module_is_available,
)

GEOSTATSPY_METHODS = frozenset(
    {
        "declus",
        "gam",
        "gamv",
        "kb2d",
        "nscore",
        "sgsim",
        "vmodel",
    }
)


class GeostatsPyProvider:
    """Narrow, auditable access to selected readable GeostatsPy implementations."""

    provider_id = "geostatspy"

    def describe(self) -> ProviderDescriptor:
        available = module_is_available("geostatspy")
        return ProviderDescriptor(
            provider_id="geostatspy",
            display_name="GeostatsPy",
            role="implementation-reference",
            availability="available" if available else "missing",
            detail=(
                "Selected Python implementations can be invoked through the allowlist."
                if available
                else "Install the analytics-engine reference extra to enable readable reference implementations."
            ),
            version=installed_version("geostatspy"),
        )

    def invoke(self, method_name: str, *args: Any, **kwargs: Any) -> Any:
        """Invoke an explicitly supported implementation with its native GeostatsPy signature."""

        if method_name not in GEOSTATSPY_METHODS:
            supported = ", ".join(sorted(GEOSTATSPY_METHODS))
            raise ValueError(f"Unsupported GeostatsPy method {method_name!r}; choose one of: {supported}")
        try:
            geostats = import_module("geostatspy.geostats")
        except ImportError as error:
            raise ProviderUnavailableError(
                "GeostatsPy is not installed; install geoeye-analytics-engine[reference]"
            ) from error
        method = getattr(geostats, method_name, None)
        if not callable(method):
            raise ProviderUnavailableError(
                f"The installed GeostatsPy version does not expose geostats.{method_name}"
            )
        return method(*args, **kwargs)

