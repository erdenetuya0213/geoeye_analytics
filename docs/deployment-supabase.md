# Supabase production deployment

For the first rollout against the staging project, follow the step-by-step
[staging runbook](./staging-runbook.md). The ordered production steps are in the
[production to-do list](./production-checklist.md). This document is the reference behind both.

GeoEye Analytics must connect to Supabase PostgreSQL through the Data Pool API. Never put a PostgreSQL URL, database password, or service-role key in a `VITE_*` variable or browser bundle.

## 1. Confirm the shared Field schema

The Data Pool migration is additive and intentionally depends on the existing GeoEye Field tables `public.profiles`, `public.projects`, and `public.drill_holes`. Deploy or migrate GeoEye Field into the Supabase project first. The migration command stops with the missing table names; it never creates development stand-ins in production. Run `pnpm db:preflight` first: it inspects the database inside a read-only transaction and reports missing Field tables, table-name collisions, pending migrations, and Supabase exposure without changing anything.

## 2. Copy Supabase connection strings

In the Supabase dashboard, open **Connect** and copy both connection strings rather than constructing host names manually.

- `DATABASE_URL`: for this long-running Node API, use the direct connection when the host supports IPv6. Otherwise use the shared **Session pooler** on port 5432. The runtime user should be the `geoeye_api` role provisioned below. Start with `DATABASE_POOL_MAX=5`.
- `MIGRATION_DATABASE_URL`: prefer the direct connection. The Session pooler is also suitable when the release environment is IPv4-only. Do not use transaction mode for migrations.

Percent-encode reserved characters in the database password. Production defaults to encrypted TLS (`DATABASE_SSL=require`). For certificate verification, download the Supabase database CA certificate, set `DATABASE_SSL=verify-full`, and provide the PEM as `DATABASE_SSL_CA`; escaped `\n` line breaks are accepted.

Settings are split in two so schema-changing credentials never reach the running service. [`.env.production.example`](../.env.production.example) lists the runtime settings loaded into the API container. [`.env.release.example`](../.env.release.example) lists the release-only credentials (`MIGRATION_DATABASE_URL`, `DATABASE_APP_PASSWORD`) used by `pnpm production:preflight`, `production:migrate` and `production:provision-role`. Neither real file is committed.

## 3. Migrate once per release

From a trusted release job with the repository available:

```powershell
$env:NODE_ENV = "production"
$env:MIGRATION_DATABASE_URL = "<direct or session connection string>"
$env:DATABASE_SSL = "require"
pnpm db:migrate
```

Migrations acquire a PostgreSQL advisory lock, record a SHA-256 checksum in `geoeye_schema_migrations`, and are safe to run again. Applied migration files must never be edited; add a new numbered migration instead.

Migrations `0002_supabase_security` and `0003_analysis_result_packages` enable RLS on Data Pool-owned tables and revoke access from the Supabase `anon` and `authenticated` database roles. The server-side PostgreSQL connection remains the only public application path to those tables. Migration `0003` catalogs analysis JSON files and graph images without placing binary objects in PostgreSQL. Migration `0004_field_projection` adds the checkpoints of the Field projection.

Provision the restricted runtime login after the migrations:

```powershell
$env:DATABASE_APP_PASSWORD = "<a separate random password of at least 32 characters>"
pnpm db:provision-role
Remove-Item Env:DATABASE_APP_PASSWORD
```

The provisioning command grants only the reads and writes currently used by the API: read and write on Data Pool tables, and read-only access to the Field tables the projection consumes (`projects`, `drill_holes`, `logging_structures`, `core_rows`, and the dictionary tables). It is idempotent; run it again after every release so new tables receive their grants. It gives the role `BYPASSRLS` so the server can operate behind its own authorization boundary, but it is not a superuser and cannot create databases or roles. Use `geoeye_api` for a direct connection, or `geoeye_api.PROJECT_REF` for the shared pooler username. Keep the `postgres` connection only in the release job as `MIGRATION_DATABASE_URL`.

## 4. Deploy the API

Build the production image from the repository root:

```powershell
docker build -f Dockerfile.datapool-api -t geoeye-datapool-api .
```

Configure the runtime with:

- `NODE_ENV=production`;
- `DATABASE_URL` and TLS/pool settings;
- a random `DATAPOOL_BEARER_TOKEN` of at least 32 characters;
- `DATAPOOL_CORS_ORIGINS` only when the UI is on another origin;
- `PROJECTION_INTERVAL_SECONDS` (for example `300`) so the API keeps the analytical read model current with Field. Leave it at `0` to project only on demand with `pnpm db:project` or `POST /v1/projects/{projectId}/projection`.

The provided stack does this for you: `compose.production.yaml` runs the API next to a Caddy container (`Dockerfile.analytics-web`, `deploy/Caddyfile`) that serves the UI, terminates TLS with an automatically issued certificate, sets the security headers, and proxies `/api/*` to the API. Start it with `docker compose --env-file .env.production -f compose.production.yaml up -d --build`.

If you host the pieces yourself, keep the same shape: serve the frontend normally and route `/api/*` to the API after stripping `/api`. In that layout, leave `DATAPOOL_CORS_ORIGINS` blank and build the UI with `VITE_DATAPOOL_ENDPOINT=/api`. If the services use different origins, list the exact HTTPS frontend origins, comma-separated.

The API fails startup when it cannot establish TLS/authentication or when the migrated schema is absent. Use:

- `GET /live` for process liveness;
- `GET /health` for PostgreSQL/schema readiness.

After each deployment run `pnpm smoke` with `SMOKE_ENDPOINT` and `DATAPOOL_BEARER_TOKEN` set. The API writes one JSON line per request to stdout (request id, method, path, status, duration; never query strings or bodies) and returns the same id in the `X-Request-Id` response header.

Run at least two instances only after confirming the Supabase connection budget. Each instance uses up to `DATABASE_POOL_MAX` database connections.

## 5. Configure private analysis artifact storage

Run [`database/production/supabase_analysis_storage.sql`](../database/production/supabase_analysis_storage.sql) once in the Supabase SQL editor. It idempotently creates a private `geoeye-analysis-results` bucket with a 25 MiB object limit and allows only these MIME types:

- `application/json`
- `image/png`

Use this object-key convention for both analysis files and graph images:

```text
tenants/<tenant>/projects/<project>/boreholes/<borehole-or-_all-boreholes>/analytics/<feature>/v<version>/<source>__<input>__<artifact>__v<version>.<extension>
```

The browser must not receive the Supabase service-role key. A trusted server uploads the objects, computes byte size and SHA-256, and then calls `POST /v1/analysis-result-packages` to commit the PostgreSQL catalog. The request must include exactly one `analysis_file` artifact matching `analysisFileKey`; graph artifacts use `graph_image`. If catalog publication fails, delete the newly uploaded objects. The 3D workspace discovers catalog entries through `GET /v1/analysis-result-packages`; downloads should use short-lived signed URLs issued after tenant/project authorization.

Keep the bucket private, cap object size to the largest expected graph/result package, enable storage metrics, and add a lifecycle cleanup job for unreferenced upload attempts. PostgreSQL remains the authoritative index for discovery, versions, lineage, and tenant/project/borehole ownership.

## 6. Supabase production controls

Before launch:

- turn on **Enforce SSL on incoming connections**;
- use database network restrictions when the API has stable outbound IP addresses;
- run Security Advisor and confirm the Data Pool tables show RLS enabled;
- protect Supabase organization access with MFA;
- select a paid plan for production so the project is not paused for inactivity;
- configure backup retention and enable PITR when the required recovery point is shorter than daily backups;
- alert on database connection use, storage, API 5xx rate, and `/health` failures.

The current bearer token is appropriate for a controlled internal deployment. Before exposing the product to multiple end users, replace the shared token with Supabase Auth JWT validation and project-level authorization in the Data Pool API.
