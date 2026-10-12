# Implementation plan

## Milestone 1 — Data Pool contract foundation

- [x] Establish repository and package boundaries.
- [x] Define variable, dataset, observation, drillhole, and analysis contracts.
- [x] Define the initial semantic variable registry.
- [x] Define Field `logging_structures` projection behavior.
- [x] Add the PostgreSQL foundation migration and seed data.
- [x] Define the HTTP API contract and client boundary.
- [ ] Implement the Data Pool API against a disposable PostgreSQL instance.
- [ ] Add the projection worker and checkpointing.
- [ ] Validate mappings against a sanitized export of real Field templates and structures.

## Milestone 2 — Collar, survey, and desurvey

- Add collar/survey CRUD through the Data Pool API.
- Add CRS lookup and validation.
- Implement and test minimum-curvature desurvey in the Python analytics engine.
- Export Arrow record batches for a project snapshot.

## Milestone 3 — Analytics desktop vertical slice

- Install the Rust/Tauri toolchain.
- Scaffold Tauri 2 + React/Vite shell.
- Add project and Data Pool connection screens.
- Create DuckDB/Parquet local workspace manifests.
- Implement Alpha/Beta to true orientation.
- Add stereonet and joint-set analysis.
- Save draft results and publish accepted results with lineage.

## Definition of the first architecture validation
  
An accepted Field Alpha/Beta observation can be  projected, combined with collar/survey data, analyzed locally, rendered on a stereonet, assigned to a joint set, and published as an accepted derived value without modifying the original Field row.


## Milestone 4 — Geostatistics engine boundary (Phase 0)

- [x] JSON-lines stdio server in the Python engine (`serve`).
- [x] Electron sidecar with allow-listed methods, status IPC, dev/packaged Python resolution.
- [x] Typed renderer client + Settings → Engine status panel.
- [ ] Bundle embedded Python runtime in `after-pack`.
- [x] First analytical jobs on the engine: cell declustering + top-cut analysis (Grade page).

## Milestone 5 — Variography (Phase 2)

- [ ] Normal-scores transform + back-transform table.
- [ ] Experimental variograms: downhole, directional (dip/dip-dir, tolerances, bandwidths), fan/continuity map.
- [ ] Nested model auto-fit (nugget + sph/exp/gau), linked sills.
- [ ] Variography page: 4 linked panels + fan + model drawer; 3D ellipsoid in scene; rotation export.
