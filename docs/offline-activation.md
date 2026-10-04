# Offline activation

GeoEye Analytics for Windows opens with an email address and a signed activation key. No API server, password, internet connection, or Supabase credential is needed to activate or reopen the app. The app remembers a valid activation for the current Windows user. Sign out removes the remembered key. Renewals use the same email and preserve the local account identity and project files.

The app verifies Ed25519 signatures using `apps/analytics-desktop/electron/activation-public.pem`. License claims include the product, normalized email, license ID, start time, and exclusive expiry time. Expired, future, altered, wrong-product, wrong-email, and untrusted keys fail closed. The native process verifies activation before project storage and Database requests; the UI also checks at startup, every minute, on focus/resume, and at expiry.

Activation and the last-seen clock timestamp are encrypted with Windows safeStorage under `%LOCALAPPDATA%/GeoEye/Analytics/secrets/`. Neither is stored in browser cache. Key text is never sent to the Database. Synchronization remains a separate optional [administrator-configured Database connection](./configured-database-connection.md); activation does not grant access to server projects. The Connection button uses that protected configuration without asking the user for another password.

## Issuing keys

An issuer key pair has been initialized for this checkout. The private key is in `.local-activation-issuer/private.pem`, ignored by Git and excluded from the desktop package. Keep a secure backup of this file. The public key must be tracked and is shipped with the app. Do not regenerate it for each build: existing activation keys depend on it.

From the repository root, issue a key with an explicit email and UTC expiry:

```powershell
node scripts/activation-key.cjs issue --private .local-activation-issuer/private.pem --email user@company.com --expires 2027-10-04T00:00:00Z
```

Give the resulting `GEA1.…` key to that user along with the email and expiry. They paste it into the Windows app. The expiry is an exact instant (the example is 08:00 on October 4 in Ulaanbaatar). No customer key has been issued automatically.

For a new product deployment with no existing issuer keys, initialize once:

```powershell
node scripts/activation-key.cjs init --private .local-activation-issuer/private.pem --public apps/analytics-desktop/electron/activation-public.pem
```

Initialization refuses to overwrite existing files. Distribute only the app/public key; keep the issuer tool and private key with the administrator. Key rotation requires a new build and newly issued keys.

## Local work and limits

After activation, choosing a workspace folder creates an empty local project for that email. Imports and results go to the native project database and folders. There are no sample records. Offline activation is a license check, not verification of email ownership: possession of the key and email grants access. These keys are not device-bound and can be used on another computer.

The protected last-seen clock detects ordinary clock rollback (five-minute tolerance) and remembers observed expiry even across sign-out. A fully offline application cannot guarantee trusted time or immediate revocation against a user who controls the executable, restores old machine state, or removes protected records. Stronger enforcement would require periodic online validation or a trusted hardware clock. No such online requirement is enabled here.

Verify with `pnpm --filter @geoeye/analytics-desktop test` and `pnpm --filter @geoeye/analytics-desktop build`. Tests generate their own ephemeral signer and do not use the production issuer key. Native handler tests exercise real SQLite files with a mocked Electron host; they do not verify Windows safeStorage itself or a real customer's interactive login.
