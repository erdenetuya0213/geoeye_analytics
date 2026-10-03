from __future__ import annotations

from pathlib import Path

from .base import ProviderDescriptor
from .geostatspy_provider import GeostatsPyProvider
from .gslib_provider import GslibProvider
from .pygeostat_provider import PygeostatProvider


def provider_catalog(gslib_directory: str | Path | None = None) -> tuple[ProviderDescriptor, ...]:
    """Return runtime availability without importing optional scientific packages."""

    return (
        ProviderDescriptor(
            provider_id="geoeye-native",
            display_name="GeoEye native",
            role="compute",
            availability="available",
            detail="GeoEye-owned orchestration and interactive EDA calculations.",
            version="0.1.0",
        ),
        PygeostatProvider().describe(),
        GeostatsPyProvider().describe(),
        GslibProvider(gslib_directory).describe(),
    )

