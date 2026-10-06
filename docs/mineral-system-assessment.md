# Mineral-system assessment

Mineral-system assessment extends **Multivariate**, using the existing GeoEye analytical UI and result-package contracts. Data Pool's **Mineral evidence** action opens the function. Assay, XRF, spectral mineral identification, and geological observations contribute evidence through explicit field mappings. It runs locally in a Web Worker and requires no API key.

## Workflow

1. Choose an interval support, usually laboratory assays or geological logging, and the source datasets to integrate.
2. Suggest mappings or add criteria manually. Review each source field, predicate, concentration unit, evidence polarity, and reliability. Numeric spectral abundance or identification scores need explicit mappings and thresholds in their source units. An optional Quality filter can require a minimum identification / acquisition score on the same matched source row; missing or inadequate quality cannot establish evidence.
3. Run the assessment on all supports or the linked selection. Inspect the sixteen system assessments, criterion contributions, actual observed values, source IDs, and input notices.
4. Compare source exclusions in Sensitivity analysis. These recalculations do not change the observed assessment. Investigation priorities identify unobserved, conflicting, and contradictory criteria and suggest geological checks.
5. Open Evidence in 3D. Switch mineral systems and colour actual assessed supports by fit, coverage, evidence state, or contributing datasets. Interval picking retains shared selection and source lineage. Existing plan, section, split views, filtering, and survey trajectories remain available. These colours do not interpolate an orebody.
6. Save or Save As to retain an analysis JSON document, ranking PNG, source lineage, configurations, and rule version. Mineral assessment uses its own template ID within the multivariate result feature, so it does not overwrite PCA / clustering templates. Saved versions reopen their own evidence in 3D. Changed source snapshots require a new run before displaying evidence colours.

## Support and source semantics

The selected base dataset establishes the population. Attachments use the existing analytical support matcher: normalized drillhole identity, overlapping depth intervals, and points registered within an interval. Greatest overlap wins, followed by the shallowest / first source row. Interval endpoints are inclusive for point matching. Multiple readings are not averaged or composited; select or composite an appropriate support first when that is required.

Assay, XRF, and spectral fields are namespaced by dataset before matching. Identical field keys in different methods cannot overwrite one another. Every match retains field, original value, comparison value, reliability, dataset, and source observation IDs. Invalid drillhole / depth support is excluded and counted. Missing fields, unqualified observations, unmatched sources, and unknown concentration units never imply tested absence.

Concentration screening thresholds use ppm. Recognized source units are ppm, mg/kg, g/t, ppb, micrograms/kg, and weight percent. Source units remain inspectable. Underscored ppm / ppb import headers are recognized; ambiguous headers require explicit units or a reviewed mapping in source units. Automatic portable-XRF suggestions exclude Au, Pt, and Li. Method validity and QA/QC still need geological review.

Categorical criteria use literal phrases rather than unrestricted regular expressions. Negated or uncertain phrases cannot automatically establish mineral presence. Tested absence is entered as an explicit contradiction predicate, preferably an exact match to a recorded test result. Numerical spectral scores are not silently interpreted as mineral identity.

## Calculation

The starter registry contains sixteen commonly used deposit-system signatures and six mineral-system components. Its screening thresholds, criterion weights, and method reliability defaults are heuristic working assumptions, not trained or calibrated parameters. Geological descriptions are informed by [USGS Mineral Deposit Models](https://pubs.usgs.gov/bul/b1693/), the [Porphyry Copper Deposit Model](https://pubs.usgs.gov/sir/2010/5070/b/pdf/SIR10-5070B.pdf), and [Descriptive Models for Epithermal Gold-Silver Deposits](https://pubs.usgs.gov/sir/2010/5070/q/sir20105070q.pdf). This implementation is not a reproduction or validation of those models. Versioned criteria live in `mineralSystemModels.ts`.

For each criterion, support and contradiction are the maximum qualifying reliability in each polarity. Repeated observations and repeated measurements cannot multiply these strengths. The criterion's signed contribution is `weight × (support − contradiction)`. Within each component / correlated group, positive and negative contributions are separately capped at the largest configured criterion weight. The reported fit is `100 × max(0, summed signed capped contribution / summed group capacity)`. With no observed criteria, fit is unavailable rather than a fabricated prior.

Criteria coverage counts observed support or contradiction. Reliability averages maximum polarity reliability over observed criteria. Component coverage averages reliability over all configured criteria of the component, with missing criteria contributing zero. Conflicting evidence remains visible even if signed contributions cancel. Project fit pools qualifying evidence across the selected supports; it does not establish co-occurrence, temporal association, or a genetic relationship. Interval colours calculate the same model on the evidence linked to each actual support.

Scores are independent indices and do not sum to 100%. They are not discovery probabilities, resource estimates, or geostatistical uncertainty. Investigation priority is a relative criterion-weight / effort planning proxy. Report assumptions and validate local background, detection limits, mineral identification, spatial continuity, paragenesis, and timing before using assessments for exploration decisions.

## Verification

Engine tests cover three-method integration, source-specific units and lineage, invalid joins, repeated measurements, tested absence, uncertainty, explicit spectral score thresholds, source sensitivity, selection populations, and stale 3D projections. Storage tests cover durability, corruption, isolated population / mineral templates, and version-specific reopen. The browser verification uses separate synthetic fixtures; production never substitutes demonstration observations for project data.
