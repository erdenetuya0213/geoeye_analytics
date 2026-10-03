# Production to-do list

The production environment is one Docker host running two containers, with Supabase as the
database:

```text
Browser ──HTTPS──► web (Caddy: TLS, static UI, /api proxy) ──► api (Data Pool API) ──TLS──► Supabase PostgreSQL
                                                                                              ▲
GeoEye Field ─────────────────────────────────────────────────────────────────────────────────┘
```

| Piece | File |
|---|---|
| API image | `Dockerfile.datapool-api` |
| Web image (UI + Caddy) | `Dockerfile.analytics-web`, `deploy/Caddyfile` |
| Stack definition | `compose.production.yaml` |
| Runtime settings (on the host) | `.env.production` from `.env.production.example` |
| Release credentials (off the host) | `.env.release` from `.env.release.example` |
| Commands | `pnpm production:*` |
| Image publishing | `.github/workflows/release.yml` |

Work through the list in order. Each item names who can do it.

## 1. Unblock the workstation — you

- [ ] Install Node.js 22 and enable pnpm (`corepack enable`). Neither is on this machine's PATH.
- [ ] Install Docker Desktop if you want to build or run the stack locally.
- [ ] Make git usable in this checkout. The `.git` folder is owned by another Windows account, so
      git refuses to run:
      `git config --global --add safe.directory C:/Users/97688/repos/GeoeyeAnalytics`
- [ ] Commit and push. Nothing from the unified-database or production work is committed yet.
- [ ] Confirm CI is green on GitHub. This is the first real Docker build of both images.

## 2. Pass staging first — you, with `docs/staging-runbook.md`

- [ ] `pnpm staging:preflight` shows no `BLOCK` lines against the real staging database.
- [ ] Complete the staging acceptance checklist. It has not been run against Supabase yet.
- [ ] Note which `selections_json` keys the real Field templates use, and add the bindings production
      will need.

## 3. Decisions only you can make

- [ ] **Host.** Any Linux machine with Docker and a public IP works (cloud VM or the mine/office
      server). A stable outbound IP lets you restrict database access to it.
- [ ] **Host name.** For example `analytics.yourdomain.com`.
- [ ] **Access model.** Today everyone shares one bearer token and can see every project. That is
      acceptable for a controlled internal pilot only. See section 8.

## 4. Supabase production project — you, in the dashboard

- [ ] Create a separate production project. Do not reuse staging.
- [ ] Choose a paid plan so the project is never paused for inactivity.
- [ ] Deploy GeoEye Field to it first. The Data Pool migrations need Field's tables.
- [ ] Turn on **Enforce SSL on incoming connections**.
- [ ] Restrict database network access to the production host's IP and your release machine.
- [ ] Protect the Supabase organization with MFA.
- [ ] Set backup retention, and enable point-in-time recovery if a day of data loss is unacceptable.

## 5. Secrets — you

- [ ] Generate a production API token and a `geoeye_api` database password, each at least 32 random
      characters and different from staging:
      `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`
- [ ] On the release machine: copy `.env.production.example` to `.env.production` and
      `.env.release.example` to `.env.release`, then fill both in.
- [ ] Store the token and passwords in a password manager. Neither file is committed.

## 6. Database release — you, from the release machine

```powershell
pnpm production:preflight        # read-only; resolve every BLOCK line
pnpm production:migrate
pnpm production:provision-role
pnpm production:project
```

- [ ] All four commands succeed, and a second `production:migrate` reports the schema current.
- [ ] Clear `DATABASE_APP_PASSWORD` in `.env.release` afterwards.
- [ ] Run `database/production/supabase_analysis_storage.sql` once in the Supabase SQL editor.
- [ ] Supabase Security Advisor shows RLS enabled on every Data Pool table.

## 7. Deploy and verify — you, on the host

- [ ] Point the DNS record of the host name at the host. Open ports 80 and 443.
- [ ] Copy the repository (or pull the released images) and `.env.production` to the host.
      `.env.release` stays off the host.
- [ ] Start the stack:
      `docker compose --env-file .env.production -f compose.production.yaml up -d --build`
      (`pnpm production:up` runs the same command.)
- [ ] `docker compose --env-file .env.production -f compose.production.yaml ps` shows `api` healthy and `web` running. Caddy
      obtains the TLS certificate on first start.
- [ ] Set `SMOKE_ENDPOINT=https://<host name>/api` in `.env.production` and run
      `pnpm production:smoke`. Every line must say `PASS`.
- [ ] Open `https://<host name>`, choose **Connection**, keep `/api`, paste the token. The top bar
      lists the production projects and **Data Pool** shows the Field feed.
- [ ] Confirm Field still works unchanged against the same database.

## 8. Before opening it beyond the pilot group — engineering work, not done yet

- [x] **Per-user login and project authorization.** Users sign in with their GeoEye Field
      account. The API limits each user to their organization's and their own projects, and
      enforces read-only roles. Set `DATAPOOL_SESSION_SECRET` in `.env.production`.
- [x] **No sample data in production.** Production builds have no demo workspace; without a
      session only the sign-in form is shown.
- [ ] **Analysis workspaces on live data.** Explore, Structure, Geotechnical, Multivariate, Domain
      and 3D do not read the Data Pool yet and show a notice instead. Only Data Pool and
      Drillholes are live.
- [ ] **Analysis artifact upload.** The API catalogs analysis files and graph images, but nothing
      uploads them to the private storage bucket yet.
- [ ] **Desktop packaging.** The architecture calls for a Tauri desktop app; today the UI ships as
      a web app.

## 9. Operations — set up once the stack is live

- [ ] Uptime check on `https://<host name>/api/health` with an alert. It fails when the database or
      schema is unreachable, not only when the process is down.
- [ ] Alerts in Supabase for connection count and storage.
- [ ] Keep container logs (`pnpm production:logs`). The API logs one JSON line per request with a
      request id that is also returned in the `X-Request-Id` header.
- [ ] Rotate the API token and the `geoeye_api` password on a schedule and when someone leaves.
- [ ] Back up the `caddy_data` volume or accept certificate re-issuance after a host rebuild.

## Releasing a new version

1. Merge to `main` with CI green.
2. Tag it: `git tag v0.2.0` then `git push origin v0.2.0`. The release workflow publishes both
   images to the GitHub Container Registry.
3. From the release machine: `pnpm production:preflight`, `pnpm production:migrate`,
   `pnpm production:provision-role`.
4. On the host: `pnpm production:up`, then `pnpm production:smoke`.

Migrations are additive, so the previous images keep working against a migrated database. To roll
back the application, start the previous image tag again. Roll back a migration only by applying its
`.down.sql` by hand, which removes Data Pool data and never touches Field tables.

## What was verified without Docker or Supabase

Checked on this workstation against a local PostgreSQL 16 and a locally run Caddy:

- both Dockerfiles' install and build steps, replayed command by command outside Docker;
- the Caddy configuration, the `/api` proxy, deep links, cache headers and security headers;
- every main screen loaded through Caddy with the content security policy active, with no blocked
  resource;
- the smoke test and the live Data Pool and Drillholes screens through the proxy with token
  authentication.

Not verified: the container images on a real Docker engine, automatic TLS issuance, and anything
against a real Supabase project.
