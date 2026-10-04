# Implementation plan

## Milestone 1 — Data Pool contract foundation

- [x] Establish repository and package boundaries.
- [x] Define variable, dataset, observation, drillhole, and analysis contracts.
- [x] Define the initial semantic variable registry.
- [x] Define Field `logging_structures` projection behavior.
- [x] Add the PostgreSQL foundation migration and seed data.
- [x] Define the HTTP API contract and client boundary.
- [x] Implement the Data Pool HTTP API and transaction-backed PostgreSQL store.
- [x] Add a disposable PostgreSQL 16 harness and end-to-end integration test.
- [x] Execute the PostgreSQL integration tests against PostgreSQL 16 (local server and CI service container).
- [x] Add the projection worker and checkpointing (`logging_structures` and core-row RQD).
- [x] Align the development stand-in schema with the real Field Hub schema.
- [ ] Run the staging rollout in `docs/staging-runbook.md` against the Supabase staging project.
- [ ] Validate bindings against the real Field templates in staging (preflight lists the `selections_json` keys in use).

## Milestone 2 — Collar, survey, and desurvey

- [x] Add project and drillhole discovery through the Data Pool API.
- [x] Add collar save and downhole-survey replacement through the Data Pool API; CRS rows are registered on first use.
- [ ] Validate CRS codes against an authority list.
- Implement and test minimum-curvature desurvey in the Python analytics engine.
- Export Arrow record batches for a project snapshot.

## Milestone 3 — Analytics desktop vertical slice

- Install the Rust/Tauri toolchain.
- [x] Scaffold the React/Vite desktop-first shell with a localhost demo workspace.
- [ ] Wrap the verified web shell in Tauri 2.
- [x] Add project overview and Data Pool connection screens.
- [x] Resolve the active workspace to a Data Pool project and show live Data Pool and Drillholes screens when connected.
- [x] Publish collar and survey CSV imports to the Data Pool.
- [x] Add first Drillholes and Structure Lab interaction screens.
- Create DuckDB/Parquet local workspace manifests.
- Implement Alpha/Beta to true orientation.
- Add stereonet and joint-set analysis.
- Save draft results and publish accepted results with lineage.

## Milestone 4 — EDA vertical slice

- [x] Implement tested, presentation-independent summary, histogram, CDF, probability, correlation, regression, and swath calculations.
- [x] Render the Explore registry with the shared Apache ECharts 6 `GeoEyeChart` and GeoEye theme.
- [x] Link source-observation selections between EDA views with the global GeoEye SelectionContext.
- [x] Load and cache the analytical snapshot through TanStack Query.
- [x] Preserve missing values and pairwise-complete populations instead of coercing nulls to zero.
- [x] Expose dataset, drillhole, lithology, comparison-variable, and swath-axis controls.
- [x] Resolve the selected workspace to a Data Pool project UUID.
- [x] Replace the labelled demo adapter in the analysis workspaces with normalized Data Pool observation loading and project-scoped query caches.
- [ ] Add Arrow/Parquet snapshot transport for production-scale project datasets.
- [ ] Move production-scale calculations behind the execution backend and Python analytics engine.

## Definition of the first architecture validation

An accepted Field Alpha/Beta observation can be projected, combined with collar/survey data, analyzed locally, rendered on a stereonet, assigned to a joint set, and published as an accepted derived value without modifying the original Field row.
