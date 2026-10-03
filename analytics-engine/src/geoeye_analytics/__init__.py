"""GeoEye's provider-neutral local analytics engine."""

from .distribution import DistributionEngine, InvalidWeightsError
from .multivariate import MultivariateEngine

from .providers import (
    GEOSTATSPY_METHODS,
    GSLIB_PROGRAMS,
    GeostatsPyProvider,
    GslibProvider,
    ProviderDescriptor,
    ProviderUnavailableError,
    PygeostatProvider,
    SpatialColumns,
    provider_catalog,
)

__all__ = [
    "DistributionEngine",
    "GEOSTATSPY_METHODS",
    "GSLIB_PROGRAMS",
    "GeostatsPyProvider",
    "GslibProvider",
    "InvalidWeightsError",
    "MultivariateEngine",
    "ProviderDescriptor",
    "ProviderUnavailableError",
    "PygeostatProvider",
    "SpatialColumns",
    "provider_catalog",
]

__version__ = "0.1.0"
