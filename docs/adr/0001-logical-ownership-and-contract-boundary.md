# ADR 0001: Logical ownership and the Data Pool contract boundary

- Status: Accepted
- Date: 2026-09-29

## Context

GeoEye Field is a mature PWA with an established PostgreSQL schema. Its dynamic logging model is intentionally flexible and stores field selections in JSONB. GeoEye Analytics needs stable, typed, columnar-friendly data without coupling itself to Field table layouts.

## Decision

1. Keep the existing `public.*` Field tables and relationships intact.
2. Add shared registry and analytical result tables to the same PostgreSQL database.
3. Expose Field records through a normalized `observation_values` projection.
4. Resolve Field template keys to semantic variable keys through explicit projection bindings.
5. Require every derived value to belong to an immutable analysis run and to identify its inputs.
6. Let applications consume Data Pool contracts rather than another application's tables.

## Consequences

- GeoEye Field can evolve its UI and JSONB payloads without forcing matching Analytics releases.
- A projection worker/API must detect stale or invalid bindings and expose those issues operationally.
- There is one authoritative PostgreSQL data store per Data Pool node, plus non-authoritative local analytical caches.
- Accepted analytical results can be shared, while draft experiments remain isolated by lifecycle state.

