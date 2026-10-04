# Windows local-first storage

## Import, export, and outbox workflow

- New collar/survey, laboratory, XRF, spectral, and strength CSV imports archive their exact source bytes beneath `imports/tenants/<tenant>/projects/<project>/<unique-id>/`. Parsed rows remain in the project's SQLite database. Repeated filenames never overwrite older archives.
- Database → **Export project JSON** writes the durable local snapshot and drafts beneath the matching hierarchy in `exports`. Structure → **Export plot** writes a standalone SVG there. Successful actions display the saved path.
- Opening the Database file panel archives older parsed drafts as `parsed-*.json`. These are explicitly recovered records, not fabricated original CSVs.
- **Sync pending imports** explicitly queues uploads. SQLite `transfer_outbox` is authoritative, scoped to endpoint/account and project. Readable status manifests live in `sync/tenants/<tenant>/projects/<project>/<account-scope>/outbox.json`; editing these files cannot initiate uploads.
- Repeatable PUT transfers retry with bounded exponential backoff while the Database page stays open. Closing the application preserves queue entries and progress; reopen Database and click Sync to resume. Expired in-flight leases recover after two minutes.
- Unconfirmed CSV POST uploads stop in **needs-review** because the current server creates a version for every POST. Verify the remote dataset before choosing Retry after review. No unconfirmed POST is automatically replayed. Remove from queue retains local data and does not undo remote writes.
- Unknown drillholes, invalid surveys, missing CRS, and permission failures remain visible. The app does not create Field holes or change Field authentication.
- Imports show success only after database persistence and source archiving complete. Analysis saves await file and document writes. Disk failures surface in the UI with the in-memory data retained for retry.

GeoEye Analytics is a Windows local-first application. The desktop process uses local CPU, memory, GPU,
and files for its work. The embedded browser renderer has no direct filesystem access; it can only call a
small set of validated operations exposed by the native host.

## Storage boundary

Two roots have different purposes and must not be mixed.

### Application-private data

Default location:

```text
%LOCALAPPDATA%\GeoEye\Analytics\
├── settings.json
├── secrets\
│   └── database-session.bin
└── Cache\
    └── WebData\
```

- `settings.json` stores application preferences, the selected workspace path, endpoint information, and
  the endpoint/account/project-to-folder registry.
- `database-session.bin` is encrypted through Electron `safeStorage`, which uses Windows-provided
  encryption. GeoEye refuses to persist the credential if encryption is unavailable.
- `Cache\WebData` is disposable embedded-browser state. No project record or analysis result relies on it.

### User-owned workspace

The user chooses a folder from the Data Pool screen. If the chosen folder is not already named `GeoEye`,
the application creates a `GeoEye` child directory:

```text
<chosen folder>\GeoEye\
├── workspace.json
├── tenants\
│   └── <tenant-id>\
│       └── projects\
│           └── <project-id>\
│               ├── project.sqlite
│               └── objects\
│                   └── tenants\<tenant-id>\projects\<project-id>\...
├── imports\
├── exports\
└── sync\
```

This root is durable and portable. It contains database-synchronized records, offline drafts, generated
analysis outputs, and artifact metadata. It must never contain access tokens or database passwords.

## Project database mapping

Each project has one SQLite database with WAL journaling, full synchronous writes, foreign-key checking,
and atomic file replacement for adjacent artifacts. The local schema follows Data Pool concepts rather
than serializing the entire project into an opaque browser value.

| Domain concept | Local table |
|---|---|
| Project and authorized local accounts | `projects`, `authorized_accounts` |
| Semantic registry | `variable_definitions` |
| Dataset catalog | `datasets` |
| Drillholes, collars, and surveys | `drill_holes`, `drillhole_collars`, `drillhole_surveys` |
| Canonical analytical observations | `observation_values` |
| Field logging projection | `logging_templates`, `logging_submissions`, `logging_datasets`, `logging_structures`, `projection_checkpoints` |
| Offline work | `local_drillhole_drafts`, `local_tabular_drafts`, `project_documents` |
| Synchronization | `sync_state`, `sync_journal` |
| Analysis and lineage | `analysis_runs`, `derived_values`, `derivation_inputs` |
| Saved output packages | `analysis_result_packages`, `analysis_result_artifacts` |

The JSON payload column retained on domain tables is a compatibility envelope for lossless round trips;
filterable identity, relationship, depth, value, status, and timestamp fields remain normal SQL columns.

## Synchronization rules

1. A successful Data Pool refresh replaces the synchronized snapshot in a single SQLite transaction.
2. Local drillhole and tabular edits are durable before publication and have pending entries in
   `sync_journal`.
3. Publishing uses the existing Data Pool API and never writes the central database directly.
4. A project database is registered by endpoint, signed-in account, tenant, and project. Reads by an
   account not listed in `authorized_accounts` are rejected.
5. Primary observations remain authoritative in the Data Pool after sync. An unpublished local edit or
   generated result is authoritative in the workspace until it is deliberately published.

## Analysis files

Saved analysis JSON and graph PNG files are regular files below the project's `objects` directory. SQLite
stores their logical object key, relative path, media type, byte size, and SHA-256 checksum. This keeps
large content out of settings and web storage while preserving the same tenant/project/borehole/feature
hierarchy used by analysis result contracts.

## Failure behavior

- Without a selected desktop workspace, GeoEye does not silently save project data to web cache.
- Database writes use transactions. Settings and artifact files use a temporary sibling followed by an
  atomic rename.
- The browser development build retains local browser storage only as a compatibility fallback; it is not
  the Windows deployment storage model.
