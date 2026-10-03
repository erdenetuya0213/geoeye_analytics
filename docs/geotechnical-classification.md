# Geotechnical classification contract

The Geotechnical workspace is a deterministic interval calculator. It uses the existing Data Pool dataset/template architecture and never updates primary observations.

## Workflow boundary

```text
MethodDefinition
→ InputResolver
→ DeterministicCalculator
→ Result
→ Save template projection + analysis file
```

The first available method is `rmr76`. Method definitions own required canonical variables and a version. The resolver maps completed source templates to those variables with an explicit priority of direct, derived, fallback, then missing. The calculator receives only resolved typed inputs; React components do not contain rating or classification logic.

The result remains unsaved until the user reviews the interval results and selects **Save**. Data Pool snapshots are explicit calculation inputs: refresh can discover a newer compatible snapshot, but it never changes the active run until the user selects **Use latest** and recalculates. Save overwrites the active logging-template version; Save As creates the next version and retains the previous version. Either action writes `geotech.rmr76` and `geotech.rmr76_class` as GeoEye-owned derived fields and writes the RMR76 analysis file in the same operation. Component ratings may also be saved. Every saved interval preserves the method version, calculation run ID, snapshot ID, source template and field IDs, source observation IDs, template version, and timestamp.

## Structure Analysis dependency

Geotech does not derive J1/J2/J3. The required path is:

```text
GeoEye Field Alpha/Beta
→ Structure Analysis
→ accepted J1/J2/J3
→ Geotech canonical structure inputs
```

The accepted Structure result supplies joint-set spacing and the excavation-relative orientation rating with lineage. When no accepted Structure result covers an interval, the interval is marked missing and links back to Structure Analysis.

## RMR76 — Bieniawski 1976

The deterministic calculator rates intact-rock strength, RQD, joint spacing, joint condition, and groundwater, then applies the excavation-specific orientation adjustment. Exact lookup boundaries use the higher-quality band. The total is bounded to 0–100 and classified into Classes I–V.

Sources: [Bieniawski, *Rock mass classifications in rock engineering* (1976)](https://richardbieniawski.wordpress.com/publications/); reproduced rating tables in [Hoek, Kaiser & Bawden, *Support of Underground Excavations in Hard Rock*, pp. 103–104](https://www.rocscience.com/assets/resources/learning/hoek/Support-of-Underground-Excavations-in-Hard-Rock.pdf).

## RQD policy

Measured RQD is a direct input and wins over estimates. When project policy allows an automated Priest–Hudson estimate, it is labelled derived and never overwrites measured RQD:

`RQD_est = 100 × exp(-0.1 × lambda) × (0.1 × lambda + 1)`

Source: [Priest & Hudson, *Discontinuity spacings in rock* (1976)](https://doi.org/10.1016/0148-9062(76)90818-4).

## Save and EDA

RMR76 metadata is stored as `type = bounded_ordinal_score`, `origin = derived`, and `method = Bieniawski 1976`. Saved numeric RMR values join the normal EDA variable registry, so the existing distribution, CDF, depth/swath, relationship, lithology/domain, and downstream 2D/3D tools can consume them without a separate publishing or analysis workflow.

Saving replaces derived values within the calculated scope of the active template version. If an interval that previously had a result becomes missing or excluded, its stale derived value is removed from that version's current projection. **Save As** creates the next immutable template revision. The most recently saved version becomes the active downstream projection, while prior versions and run history remain available. There is no separate “save to dataset” or publish step.

## Future methods

RMR89, Laubscher RMR/MRMR, and Q-System should be added as new `MethodDefinition` plus deterministic calculator implementations. They must reuse the resolver, interval result, save, and EDA projection contracts rather than adding formulas to UI components or creating parallel workflows.
