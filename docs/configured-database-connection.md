# Preconfigured Analytics Database connection

Offline activation opens the desktop app. Database access is separate, administrator-provisioned access for an existing Field account. The Connection dialog has no credential inputs: it shows the configured API and provides Connect/retry. The desktop automatically checks the configured API after activation, while retaining offline operation when the API is unavailable.

No Field authentication code, accounts, passwords, memberships, or API authorization rules are changed. The existing Data Pool API validates its user-scoped session token and rereads account/project access. A service/admin bearer token is never embedded in the desktop app. An activation key alone is not a Database credential.

## Staging administrator setup

Build the API dependencies, then start the local API with `.env.staging`. For connection-only verification, set `PROJECTION_INTERVAL_SECONDS=0` in the process environment so the scheduler does not modify analytical projections. The API binds to `127.0.0.1:8080` in this checkout. It is a background process, not an installed Windows service; restart it after a computer reboot.

Build the desktop. From the repository root, provision the existing licensed email and launch the new executable:

```powershell
node scripts/configure-staging-analytics.mjs --email info@astrogeo.mn --expires 2026-11-03T13:43:20Z --app "apps/analytics-desktop/release-configured-api/GeoEye Analytics Portable 0.1.0.exe"
```

Use `--check` instead of `--app ...` for a read-only identity/project-access check without saving a connection. The script reads the staging session-signing secret only in the administrator process. It looks up the existing active account without reading its password/hash, refuses accounts requiring a Field password change, and creates an API session valid no longer than 30 days. Choose an expiry no later than the activation expiry.

The one-time launch passes the user-scoped session in a process environment variable (never a command-line argument or plaintext output file). The app removes that variable before creating renderer processes, verifies `/v1/auth/me`, checks that the account email and expiry match the active offline license, and encrypts the configuration at:

`%LOCALAPPDATA%/GeoEye/Analytics/secrets/configured-database.bin`

The renderer receives only endpoint/account metadata. The native host attaches authorization only to the exact configured origin and `/v1/` API path; redirects are not followed. Remote endpoints require HTTPS; plain HTTP is allowed only for loopback. The encrypted configuration survives app restarts and offline sign-out, but cannot be used by another licensed email or after expiry. Re-run provisioning to renew Database access. Neither the database password nor the signing secret is shipped in the app.

Choose a workspace folder in the desktop to persist synced project snapshots and analysis files. Connection itself reads projects and does not import samples, change Field authentication, or automatically write database data.
