# GeoEye Analytics Platform

Contract-first foundation for the GeoEye Data Pool and GeoEye Analytics desktop application.

The implementation follows [GeoEye Platform Architecture v0.1](./GeoEye_Platform_Architecture_v0.1.md). GeoEye Field remains the owner of primary geological observations. This repository defines the stable Data Pool boundary, normalized analytical projection, and contracts used by Analytics.

## Current milestone

Phase 1 establishes:

- canonical TypeScript contracts for variables, datasets, observations, drillholes, and analytical results;
- a semantic variable registry with the first structural and geotechnical variables;
- a projection adapter for the existing Field `logging_structures` write model;
- an additive PostgreSQL migration that extends, but does not redesign, the existing Field schema;
- a typed Data Pool HTTP client and an OpenAPI contract;
- a Data Pool HTTP service backed by PostgreSQL, with transactional analysis-result publication;
- versioned GeoEye analysis packages containing derived-field lineage, an analysis JSON file, and graph-image object metadata for later 3D reuse.

The unified-database milestone connects that foundation to the real GeoEye Field database:

- a projection that reconciles accepted Field `logging_structures` and core-row RQD into `observation_values`, with change detection, per-project bindings, and issue reporting, while leaving Field tables read-only;
- shared project and drillhole discovery, plus collar and downhole-survey editing through the Data Pool API;
- a read-only database preflight, an API smoke test, and `staging:*` commands for the Supabase staging project;
- live project, Data Pool, and Drillholes screens in the Analytics UI when it is connected to a Data Pool.

To roll this out against staging, follow the [staging runbook](./docs/staging-runbook.md).
For production, work through the [production to-do list](./docs/production-checklist.md): it covers the
container stack (`compose.production.yaml`), the Supabase project settings, secrets, release, and what is
still missing before the app is opened beyond a pilot group.

## Repository layout

```text
apps/analytics-desktop/      React/Vite desktop-first Analytics UI
contracts/                   Data Pool HTTP API contract
database/migrations/         Additive PostgreSQL migrations
database/seeds/              Initial semantic variables
docs/                        Architecture decisions and delivery plan
packages/geoeye-types/       Canonical cross-application types
packages/variable-registry/  Semantic variable catalog
packages/field-projection/   Field JSONB to analytical observations
packages/analysis-contracts/ Execution backend boundary
packages/datapool-client/    Typed client used by Analytics
services/datapool-api/       Data Pool HTTP API and PostgreSQL store
```

## Development

Requirements: Node.js 20+ and pnpm.

```bash
pnpm install
pnpm check
```

### First UI

The Analytics shell runs with a complete demo workspace, so PostgreSQL is not required for the first
visual test:

```bash
pnpm dev:ui
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The Overview, Drillholes, EDA, Structure Lab, and
Data Pool screens are interactive. The connection dialog uses `/api`, which Vite proxies to the local
Data Pool service on port `8080`; if that service is unavailable, the UI stays usable in demo mode.

The EDA workspace implements the architecture's first Explore registry: summary statistics, histogram,
CDF, normal probability plot, scatter, correlation matrix, and spatial swath. Apache ECharts 6 renders
2D charts through the shared Canvas-first `GeoEyeChart`, the global GeoEye SelectionContext links source
observations across views, and TanStack Query owns snapshot loading/cache state.
The included assay snapshot is a deterministic demo fixture and is labelled as such in the UI; live
project observations will replace it once the active workspace exposes its Data Pool project UUID.

The default suite tests contracts, projection behavior, the client, and HTTP routes without external
services. To exercise the full migration, projection, query, and publish workflow against PostgreSQL 16, run:

```bash
pnpm test:postgres                                  # disposable container (Docker required)
TEST_DATABASE_URL=postgres://... pnpm test:postgres # or an existing server, no Docker
```

Each integration test file creates and drops its own database, and the projection tests run the API
as the least-privilege `geoeye_api` role. Setting `TEST_DATABASE_URL` also includes these tests in
`pnpm check`, which is how CI runs them.

For local API development:

```bash
pnpm db:up
$env:DATABASE_URL = "postgres://geoeye:geoeye@127.0.0.1:54329/geoeye" # PowerShell
pnpm db:migrate
pnpm db:project   # project Field observations into the analytical read model
pnpm dev:api
```

The local database is created from `database/dev/0000_field_prerequisites.sql`, which mirrors the
GeoEye Field Hub schema for every column the Data Pool reads. Recreate the container with
`pnpm db:down && pnpm db:up` after pulling a change to that file.

`DATAPOOL_BEARER_TOKEN` enables static bearer-token protection for non-local use. Authentication is
disabled when it is omitted; `/health` always remains public.

For a cloud deployment backed by Supabase PostgreSQL, follow the
[Supabase production runbook](./docs/deployment-supabase.md). Production mode enforces TLS, requires
a strong API bearer token, bounds the application connection pool, checks database/schema readiness,
and supports an exact HTTPS CORS allowlist. The browser connects only to the Data Pool API; database
credentials never enter the frontend bundle.

The SQL migrations expect the existing GeoEye Field tables (`projects`, `drill_holes`, and `profiles`) to exist in the same PostgreSQL database. They only add Data Pool and Analytics-owned tables. `pnpm db:preflight` checks this, read-only, before anything is applied.

The consistent Save/Save As behavior and artifact naming rules are documented in the [analysis save contract](./docs/analysis-save-contract.md).

## Integration rule

Analytics must not query `logging_structures` directly. The Data Pool projection (`services/datapool-api/src/projection.ts`) reads Field-owned rows, applies explicit semantic bindings, and publishes canonical `observation_values` records. Derived values are written through analysis runs and never overwrite primary observations.
