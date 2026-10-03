# EDA Distribution contract

GeoEye Distribution keeps **Raw** observations as the reference distribution and adds **Declustered** as an optional comparison overlay.

- **Raw** is always shown from the filtered set of finite source observations with equal row weights.
- **Declustered** optionally overlays the same source population with explicit interval-support, equal-hole, or spatial cell-declustering weights. Weighting never changes primary observations.
- **Uncertainty** remains part of the engine contract and provenance, but is not exposed as a generic distribution-toolbar checkbox. Grouped resampling uses holes, geological groups, or spatial blocks; row-wise bootstrap is intentionally unsupported because it understates clustered sampling uncertainty.

Every result preserves the Data Pool dataset ID and snapshot, variable, filters, spatial support, weighting method, bootstrap method and seed, algorithm version, and source observation IDs. Plot custom data and the shared selection store use source observation IDs so Histogram, CDF, Probability Plot, cross-dataset Relationships, Swath, and downstream spatial views can share selections without translating presentation-row IDs.

## Desktop interaction

- Descriptive statistics is the first EDA view. Summary cards and provenance are shown there rather than repeated across analytical views.
- Raw remains the reference distribution and declustering is a direct comparison toggle rather than a page mode.
- Comparative histograms use relative frequency so raw frequency and normalized declustering weights share a meaningful scale.
- Filters are generated from dataset dimension definitions. Drillhole, lithology, domain, campaign, or future dimensions use the same filter mechanism.
- Relationships accepts multiple datasets. X and Y each select a dataset and numeric variable independently; observations are paired by interval overlap while retaining source IDs from both axes. Facets reuse the completed run's Compare By / Second Group populations, Detail reports Pearson r, Spearman rho, and regression R², and Matrix computes pairwise Pearson or Spearman coefficients with matched n for every numeric variable in the selected datasets.
- Plot axes are fixed and wheel/double-click zoom is disabled. Click and box selection remain active for source-ID linking.

## DistributionEngine

The authoritative Python engine is `geoeye_analytics.distribution.DistributionEngine`:

```text
summary()
weightedSummary()
ecdf()
weightedEcdf()
probabilityPlot()
bootstrap()
diagnostics()
```

NumPy implements numerical kernels, SciPy supplies normal-score transforms and Polars owns tabular validation. The desktop preview calls a typed Web Worker adapter with the same algorithm version and semantics; React components only consume the engine contract and never import scientific libraries or execute the distribution loop during render.

Weighted quantiles and probability-plot positions use centered cumulative weights. Weighted variance uses the frequency-unbiased denominator. Probability-plot R² is stored and shown only as a secondary normal-reference fit diagnostic; it is not probability, confidence, or uncertainty.

## Library boundaries

- **NumPy / SciPy / Polars:** production DistributionEngine implementation.
- **pygeostat (MIT):** mining workflow adapter and validation reference.
- **GeostatsPy (MIT):** declustering, normal-score, and readable GSLIB-behavior validation reference.
- **GSTools (LGPL):** reserved behind a future variography adapter; it is not imported or used by Distribution.
- **External executables:** no proprietary CCG executable is bundled. The existing GSLIB adapter can only invoke explicitly configured, user-provided binaries and is not part of this Distribution path.

Kriging, simulation, and variography are outside this contract.
