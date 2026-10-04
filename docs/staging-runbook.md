# Staging runbook: unified database on Supabase

GeoEye Field and GeoEye Analytics share one PostgreSQL database. Field owns its tables and keeps
writing them as it does today. The Data Pool adds its own tables beside them, reads Field's
observations into a normalized analytical read model, and serves everything to Analytics through
the Data Pool API. Nothing in this runbook alters or writes to a Field table.

```text
GeoEye Field ──writes──► projects, drill_holes, core_rows, logging_structures, ...   (Field-owned)
                              │ read-only
                              ▼
                   projection (Data Pool API / pnpm staging:project)
                              ▼
        observation_values, datasets, drillhole_collars, analysis_runs, ...          (Data Pool-owned)
                              ▲
GeoEye Analytics ──HTTP──► Data Pool API
```

Requirements on the machine that runs these commands: Node.js 20.11 or newer (22 recommended) and
pnpm. Docker is not needed.

## 1. Configure

```powershell
Copy-Item .env.staging.example .env.staging
```

Fill in `.env.staging` from the Supabase dashboard (**Connect**). The file is git-ignored.

| Setting | Value |
|---|---|
| `MIGRATION_DATABASE_URL` | `postgres` role. Direct connection, or the Session pooler on port 5432 from an IPv4-only network. |
| `DATABASE_URL` | `geoeye_api` role, created in step 4. Pooler username is `geoeye_api.PROJECT_REF`. |
| `DATABASE_APP_PASSWORD` | New random password for `geoeye_api`, at least 32 characters. |
| `DATAPOOL_SESSION_SECRET` | New random value, at least 32 characters. Signs user sign-in sessions. |
| `DATAPOOL_BEARER_TOKEN` | Optional service token for the smoke test, at least 32 characters. |

Do not use the transaction pooler (port 6543) for the migration connection.

## 2. Preflight (read-only)

```powershell
pnpm install
pnpm staging:preflight
```

The preflight runs inside one `READ ONLY` transaction. It reports:

- whether the Field tables the Data Pool depends on exist, and that their ids are `uuid`;
- which Field sources can feed the projection, with row counts per review status;
- the `selections_json` keys Field is actually using (see step 6);
- which Data Pool migrations are applied and pending, any table-name collision, and any migration
  file that was edited after it was applied to this database;
- on Supabase, public tables readable by the `anon` role without row-level security.

`BLOCK` lines must be resolved before continuing. `WARN` lines do not stop the release; read them.

## 3. Migrate

```powershell
pnpm staging:migrate
```

Migrations are additive, checksummed in `geoeye_schema_migrations`, serialized by an advisory lock,
and safe to run again. The core variable registry and the default projection bindings are
reconciled on every run.

| Migration | Adds |
|---|---|
| `0001_datapool_foundation` | Variable registry, dataset registry, `observation_values`, collars, surveys, analysis runs, derived values |
| `0002_supabase_security` | Row-level security and revoked browser-role grants on Data Pool tables |
| `0003_analysis_result_packages` | Versioned analysis result catalog |
| `0004_field_projection` | Projection checkpoints |

Rollback: each migration has a matching `.down.sql`. Apply them in reverse order by hand in the
Supabase SQL editor and delete the corresponding rows from `geoeye_schema_migrations`. Rolling back
removes Data Pool data only; Field tables are untouched.

## 4. Provision the runtime role

```powershell
pnpm staging:provision-role
```

This creates or updates `geoeye_api`: read and write on Data Pool tables, **read-only** on the
Field tables the projection consumes, no access to anything else. Run it again after every release
so new tables receive their grants. Afterwards remove `DATABASE_APP_PASSWORD` from `.env.staging`.

## 5. Project Field data

```powershell
pnpm staging:project
```

Example output:

```text
c5af2a56-... field.logging_structure: projected (360 source rows, 720 observations; unaccepted_source=120)
c5af2a56-... field.core_row: projected (120 source rows, 96 observations; unaccepted_source=24)
```

| Field source | Becomes |
|---|---|
| `logging_structures` rows with `review_status = accepted` | One observation per bound variable (`structure.alpha`, `structure.beta`, ...) in dataset **GeoEye Field structural logging** |
| `core_rows.stage3_rqd_json.rqd_pct` of accepted rows | `geotech.rqd` in dataset **GeoEye Field RQD** |

Behaviour worth knowing:

- A run reconciles: changed values are updated in place, and observations disappear when Field
  deletes the row or withdraws its acceptance. Observation ids stay stable, so lineage holds.
- An unchanged source is skipped. `pnpm staging:project --force` reprojects anyway.
- `--project <uuid>` limits the run to one project.
- Rows that cannot be projected are counted by reason (`invalid_value`, `invalid_depth`, ...) and
  never abort the run. `unaccepted_source` is informational.
- The API repeats this automatically every `PROJECTION_INTERVAL_SECONDS` (300 on staging). Advisory
  locks make that safe with several API instances.

## 6. Bind Field template fields to variables

Field stores logging selections as JSON keyed by template field id, so the Data Pool needs an
explicit binding from each field id to a semantic variable. Defaults are seeded for the field ids
`alpha`, `beta`, `aperture`, `roughness` and the `angle_deg` column.

Compare the keys printed by the preflight with those defaults. For a template that uses different
ids, add a project binding:

```powershell
$headers = @{ Authorization = "Bearer $env:DATAPOOL_BEARER_TOKEN" }
$body = @{ bindings = @(@{
  projectId        = "<project uuid>"
  sourceEntityType = "field.logging_structure"
  sourceField      = "selections.alpha_angle"
  variableKey      = "structure.alpha"
  extraction       = @{ kind = "selection"; key = "alpha_angle" }
}) } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Put -Uri http://127.0.0.1:8080/v1/projection-bindings -Headers $headers -ContentType application/json -Body $body
```

A project binding overrides the default with the same `sourceField`. Send `isActive = $false` to
switch a default off for one project. Dictionary selections are stored by Field as dictionary item
ids; the projection replaces them with the item name.

## 7. Run the API and smoke-test it

```powershell
pnpm staging:api          # terminal 1
pnpm staging:smoke        # terminal 2
```

The API refuses to start when TLS, credentials, or the migrated schema are wrong. The smoke test
checks liveness, readiness, that authentication is enforced, the variable registry, projects,
drillholes, projection status, the dataset registry, and an observation query. It is read-only;
add `--project-now` to also trigger a projection run. Set `SMOKE_ENDPOINT` to test a deployed
API instead of the local one.

## 8. Connect GeoEye Analytics

```powershell
pnpm dev:ui
```

Open <http://127.0.0.1:5173>, choose **Sign in**, and enter the email and password of a GeoEye
account. These are the same accounts GeoEye Field uses; nothing new is created. Once signed in:

- the project selector in the top bar lists only the projects that account may open: projects it
  is a member of, plus every project of an organization it owns or administers. Platform
  administrators see all projects. Deactivated accounts cannot sign in;
- a read-only project role disables every write;
- **Data Pool** shows the Field feed per source, a **Sync from Field** action, and the dataset registry;
- **Drillholes** is the Analytics CSV workspace. **Import CSV** loads mapped collar and survey files,
  displays those imported records instead of the Data Pool borehole list, and restores the last
  import when the workspace is reopened.

The connected Overview, dataset tools, Explore, Structure, Geotechnical, Domain, Multivariate,
and 3D workspaces read the active project's Data Pool datasets and normalized observations.
They show an in-workspace empty or unavailable state when a required source is absent; they no
longer replace the whole feature with a static "No project data" shell. Demo fixtures remain
isolated to the opt-in demo workspace (`VITE_ENABLE_DEMO=true`).

## Acceptance checklist

- [ ] Preflight shows no `BLOCK` lines.
- [ ] `staging:migrate` reports all four migrations applied, and a second run reports the schema current.
- [ ] `staging:project` reports no `failed` source, and observation counts match expectations from Field.
- [ ] Field keeps working unchanged against the same database.
- [ ] `staging:smoke` passes.
- [ ] Analytics lists the staging projects, and Drillholes shows the imported collar and survey rows.
- [ ] A collar and survey imported in Analytics are restored after reopening the Drillholes workspace.
- [ ] Supabase Security Advisor shows RLS enabled on every Data Pool table.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `GeoEye Field prerequisites are missing` | Field has not been deployed to this database. Deploy Field first. |
| Preflight: `projects.id is ...; Data Pool foreign keys require uuid` | The Field schema in this database differs from the supported one. Do not migrate; align the Field schema first. |
| API exits with `relation "projection_checkpoints" does not exist` | Migrations are behind the code. Run `pnpm staging:migrate`. |
| `permission denied for table ...` in the API log | Grants are behind the code. Run `pnpm staging:provision-role` again. |
| `self-signed certificate` or TLS errors | Use `DATABASE_SSL=require`, or `verify-full` with the Supabase CA in `DATABASE_SSL_CA`. |
| Projection reports `invalid_value` for a variable | The Field value does not match the variable type, for example a dictionary class bound to a numeric variable. Rebind it to a matching variable. |
| Projection reports zero observations | No accepted rows yet, or the template field ids have no binding. See step 6. |
