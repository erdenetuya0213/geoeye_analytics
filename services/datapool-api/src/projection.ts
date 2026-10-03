import { createHash } from 'node:crypto'
import {
  projectFieldLoggingStructure,
  type FieldLoggingStructure,
  type FieldProjectionBinding,
} from '@geoeye/field-projection'
import {
  projectionExtractionSchema,
  type ObservationQuality,
  type ProjectionRunResult,
  type ProjectionSourceResult,
  type VariableDefinition,
} from '@geoeye/types'
import { VariableRegistry } from '@geoeye/variable-registry'
import type { Pool, PoolClient } from 'pg'

/**
 * Field -> Data Pool analytical projection.
 *
 * Field-owned tables are only ever read. Each run reconciles one project's
 * `observation_values` for a source with what Field currently holds: changed
 * values are updated in place (observation ids stay stable for lineage), rows
 * Field no longer exposes are removed, and an unchanged source is skipped.
 */

export interface ProjectionOptions {
  /** Reproject even when the source fingerprint is unchanged. */
  force?: boolean
  /** Also project draft and flagged Field rows, tagged with their quality. */
  includeUnaccepted?: boolean
}

interface DesiredObservation {
  sourceId: string
  holeId: string | null
  depthFrom: number | null
  depthTo: number | null
  variableKey: string
  numericValue: number | null
  textValue: string | null
  categoryValue: string | null
  booleanValue: boolean | null
  datetimeValue: string | null
  unit: string | null
  quality: ObservationQuality
  observedAt: string | null
}

interface SourceProjection {
  sourceRowCount: number
  observations: DesiredObservation[]
  issueSummary: Record<string, number>
}

interface SourceDefinition {
  sourceEntityType: 'field.logging_structure' | 'field.core_row'
  dataset: {
    name: string
    description: string
    spatialSupport: 'orientation' | 'interval'
  }
  /** Returns a reason when the Field schema cannot feed this source. */
  unavailable(client: PoolClient): Promise<string | null>
  fingerprint(client: PoolClient, projectId: string, options: Required<ProjectionOptions>): Promise<string>
  project(client: PoolClient, projectId: string, options: Required<ProjectionOptions>): Promise<SourceProjection>
}

const nullVersion = '00000000-0000-0000-0000-000000000000'
const insertChunkSize = 2_000

function countIssue(summary: Record<string, number>, code: string): void {
  summary[code] = (summary[code] ?? 0) + 1
}

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Depths must satisfy the observation_values CHECK constraints. */
function validDepths(depthFrom: number | null, depthTo: number | null): boolean {
  if (depthFrom !== null && depthFrom < 0) return false
  if (depthTo !== null && depthTo < 0) return false
  return depthFrom === null || depthTo === null || depthTo >= depthFrom
}

async function relationExists(client: PoolClient, name: string): Promise<boolean> {
  const result = await client.query<{ present: boolean }>(
    "SELECT to_regclass('public.' || $1) IS NOT NULL AS present",
    [name],
  )
  return result.rows[0]?.present === true
}

async function missingColumns(
  client: PoolClient,
  table: string,
  columns: readonly string[],
): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
  `, [table])
  const present = new Set(result.rows.map((row) => row.column_name))
  return columns.filter((column) => !present.has(column))
}

async function loadRegistry(client: PoolClient): Promise<VariableRegistry> {
  const result = await client.query<{
    key: string
    display_name: string
    description: string
    data_type: VariableDefinition['dataType']
    canonical_unit: string | null
    origin: VariableDefinition['origin']
    spatial_support: VariableDefinition['spatialSupport']
    compatible_analyses: string[]
  }>(`
    SELECT key, display_name, description, data_type, canonical_unit, origin,
           spatial_support, compatible_analyses
    FROM variable_definitions
  `)
  return new VariableRegistry(result.rows.map((row) => ({
    key: row.key,
    displayName: row.display_name,
    description: row.description,
    dataType: row.data_type,
    canonicalUnit: row.canonical_unit,
    origin: row.origin,
    spatialSupport: row.spatial_support,
    compatibleAnalyses: row.compatible_analyses,
  })))
}

interface BindingRow {
  project_id: string | null
  source_field: string
  variable_key: string
  extraction_json: unknown
  is_active: boolean
}

/** A project binding replaces the global default for the same source field. */
async function loadStructureBindings(
  client: PoolClient,
  projectId: string,
): Promise<{ bindings: FieldProjectionBinding[]; invalid: number; signature: string }> {
  const result = await client.query<BindingRow>(`
    SELECT binding.project_id, binding.source_field, variable.key AS variable_key,
           binding.extraction_json, binding.is_active
    FROM observation_projection_bindings AS binding
    JOIN variable_definitions AS variable ON variable.id = binding.variable_id
    WHERE binding.source_entity_type = 'field.logging_structure'
      AND (binding.project_id IS NULL OR binding.project_id = $1)
    ORDER BY binding.source_field, binding.project_id NULLS FIRST
  `, [projectId])

  const effective = new Map<string, BindingRow>()
  for (const row of result.rows) effective.set(row.source_field, row)

  const bindings: FieldProjectionBinding[] = []
  let invalid = 0
  for (const row of effective.values()) {
    if (!row.is_active) continue
    const extraction = projectionExtractionSchema.safeParse(row.extraction_json)
    if (!extraction.success) {
      invalid += 1
      continue
    }
    bindings.push({ variableKey: row.variable_key, source: extraction.data })
  }
  bindings.sort((left, right) => left.variableKey.localeCompare(right.variableKey))
  return { bindings, invalid, signature: JSON.stringify(bindings) }
}

/**
 * Field stores dictionary selections as dictionary item ids. Analytics needs the
 * geological label, so known ids are replaced with the item name.
 */
async function loadDictionaryLabels(client: PoolClient, projectId: string): Promise<Map<string, string>> {
  if (!await relationExists(client, 'dictionary_items') || !await relationExists(client, 'dictionary_categories')) {
    return new Map()
  }
  const result = await client.query<{ id: string; label: string }>(`
    SELECT item.id::text AS id,
           COALESCE(NULLIF(btrim(item.name), ''), NULLIF(btrim(item.code), '')) AS label
    FROM dictionary_items AS item
    JOIN dictionary_categories AS category ON category.id = item.category_id
    WHERE category.project_id = $1
    ORDER BY item.id
  `, [projectId])
  return new Map(result.rows.flatMap((row) => row.label === null ? [] : [[row.id, row.label] as const]))
}

const structureSource: SourceDefinition = {
  sourceEntityType: 'field.logging_structure',
  dataset: {
    name: 'GeoEye Field structural logging',
    description: 'Structural observations projected from GeoEye Field logging_structures.',
    spatialSupport: 'orientation',
  },

  async unavailable(client) {
    if (!await relationExists(client, 'logging_structures')) {
      return 'Field table logging_structures is not present in this database'
    }
    const missing = await missingColumns(client, 'logging_structures', [
      'id', 'project_id', 'hole_id', 'row_id', 'depth_from', 'depth_to', 'angle_deg',
      'structure_type', 'selections_json', 'review_status', 'updated_at',
    ])
    return missing.length === 0
      ? null
      : `Field table logging_structures is missing columns: ${missing.join(', ')}`
  },

  async fingerprint(client, projectId, options) {
    const rows = await client.query<{ row_count: string; digest: string | null }>(`
      SELECT count(*)::text AS row_count,
             md5(string_agg(md5(ROW(
               structure.id, structure.hole_id, structure.row_id, structure.depth_from,
               structure.depth_to, structure.angle_deg, structure.structure_type,
               structure.selections_json::text, structure.review_status, structure.updated_at
             )::text), '' ORDER BY structure.id)) AS digest
      FROM logging_structures AS structure
      WHERE structure.project_id = $1
    `, [projectId])
    const { signature } = await loadStructureBindings(client, projectId)
    const dictionary = [...(await loadDictionaryLabels(client, projectId)).entries()]
    return createHash('sha256')
      .update(JSON.stringify([
        rows.rows[0]?.row_count ?? '0',
        rows.rows[0]?.digest ?? '',
        signature,
        dictionary,
        options.includeUnaccepted,
      ]))
      .digest('hex')
  },

  async project(client, projectId, options) {
    const registry = await loadRegistry(client)
    const { bindings, invalid } = await loadStructureBindings(client, projectId)
    const labels = await loadDictionaryLabels(client, projectId)
    const issueSummary: Record<string, number> = {}
    if (invalid > 0) issueSummary.invalid_binding = invalid

    const result = await client.query<{
      id: string
      hole_id: string | null
      row_id: string
      depth_from: number | string | null
      depth_to: number | string | null
      angle_deg: number | string | null
      structure_type: string | null
      selections_json: unknown
      review_status: string
      updated_at: Date | string | null
    }>(`
      SELECT id::text AS id, hole_id::text AS hole_id, row_id::text AS row_id, depth_from,
             depth_to, angle_deg, structure_type, selections_json, review_status, updated_at
      FROM logging_structures
      WHERE project_id = $1
      ORDER BY id
    `, [projectId])

    const observations: DesiredObservation[] = []
    for (const row of result.rows) {
      const reviewStatus = row.review_status === 'accepted' || row.review_status === 'flagged'
        ? row.review_status
        : 'draft'
      const depthFrom = finiteOrNull(row.depth_from)
      const depthTo = finiteOrNull(row.depth_to)
      if (!validDepths(depthFrom, depthTo)) {
        countIssue(issueSummary, 'invalid_depth')
        continue
      }

      const selections = typeof row.selections_json === 'string'
        ? row.selections_json
        : row.selections_json !== null && typeof row.selections_json === 'object' && !Array.isArray(row.selections_json)
          ? Object.fromEntries(Object.entries(row.selections_json as Record<string, unknown>).map(
              ([key, value]) => [key, typeof value === 'string' ? labels.get(value) ?? value : value],
            ))
          : '[]'
      const source: FieldLoggingStructure = {
        id: row.id,
        projectId,
        holeId: row.hole_id,
        rowId: row.row_id,
        depthFrom,
        depthTo,
        angleDeg: finiteOrNull(row.angle_deg),
        structureType: row.structure_type === null ? null : labels.get(row.structure_type) ?? row.structure_type,
        selectionsJson: selections,
        reviewStatus,
        updatedAt: isoOrNull(row.updated_at),
      }
      const projected = projectFieldLoggingStructure(source, bindings, registry, {
        datasetId: nullVersion,
        datasetVersionId: null,
        includeUnaccepted: options.includeUnaccepted,
      })
      for (const issue of projected.issues) {
        // A binding with no value on this structure is expected, not a data problem.
        if (issue.code !== 'missing_value') countIssue(issueSummary, issue.code)
      }
      for (const observation of projected.observations) {
        observations.push({
          sourceId: observation.sourceId,
          holeId: observation.holeId,
          depthFrom: observation.depthFrom,
          depthTo: observation.depthTo,
          variableKey: observation.variableKey,
          numericValue: observation.numericValue,
          textValue: observation.textValue,
          categoryValue: observation.categoryValue,
          booleanValue: observation.booleanValue,
          datetimeValue: observation.datetimeValue,
          unit: observation.unit,
          quality: observation.quality,
          observedAt: observation.observedAt,
        })
      }
    }
    return { sourceRowCount: result.rows.length, observations, issueSummary }
  },
}

const coreRowSelect = `
  SELECT core_row.id::text AS id, core_row.hole_id::text AS hole_id,
         core_row.depth_from, core_row.depth_to,
         core_row.stage3_rqd_json ->> 'rqd_pct' AS rqd_pct,
         (to_jsonb(core_row) ->> 'stage3_accepted_at') AS accepted_at,
         (to_jsonb(core_row) ->> 'stage_status') AS stage_status
  FROM core_rows AS core_row
  WHERE core_row.project_id = $1
    AND core_row.stage3_rqd_json IS NOT NULL
    AND jsonb_typeof(core_row.stage3_rqd_json) = 'object'
`

const coreRowSource: SourceDefinition = {
  sourceEntityType: 'field.core_row',
  dataset: {
    name: 'GeoEye Field RQD',
    description: 'Rock Quality Designation per core row projected from GeoEye Field core_rows.',
    spatialSupport: 'interval',
  },

  async unavailable(client) {
    if (!await relationExists(client, 'core_rows')) {
      return 'Field table core_rows is not present in this database'
    }
    const missing = await missingColumns(client, 'core_rows', [
      'id', 'project_id', 'hole_id', 'depth_from', 'depth_to', 'stage3_rqd_json',
    ])
    return missing.length === 0 ? null : `Field table core_rows is missing columns: ${missing.join(', ')}`
  },

  async fingerprint(client, projectId, options) {
    const rows = await client.query<{ row_count: string; digest: string | null }>(`
      SELECT count(*)::text AS row_count,
             md5(string_agg(md5(ROW(
               source.id, source.hole_id, source.depth_from, source.depth_to,
               source.rqd_pct, source.accepted_at, source.stage_status
             )::text), '' ORDER BY source.id)) AS digest
      FROM (${coreRowSelect}) AS source
    `, [projectId])
    return createHash('sha256')
      .update(JSON.stringify([
        rows.rows[0]?.row_count ?? '0',
        rows.rows[0]?.digest ?? '',
        options.includeUnaccepted,
      ]))
      .digest('hex')
  },

  async project(client, projectId, options) {
    const registry = await loadRegistry(client)
    const variable = registry.get('geotech.rqd')
    const issueSummary: Record<string, number> = {}
    const result = await client.query<{
      id: string
      hole_id: string | null
      depth_from: number | string | null
      depth_to: number | string | null
      rqd_pct: string | null
      accepted_at: string | null
      stage_status: string | null
    }>(`${coreRowSelect} ORDER BY core_row.id`, [projectId])

    const observations: DesiredObservation[] = []
    if (variable === undefined) {
      issueSummary.unknown_variable = result.rows.length
      return { sourceRowCount: result.rows.length, observations, issueSummary }
    }

    for (const row of result.rows) {
      const accepted = row.accepted_at !== null || row.stage_status === 'complete'
      if (!accepted && !options.includeUnaccepted) {
        countIssue(issueSummary, 'unaccepted_source')
        continue
      }
      const rqd = finiteOrNull(row.rqd_pct)
      if (rqd === null) {
        countIssue(issueSummary, 'missing_value')
        continue
      }
      if (rqd < 0 || rqd > 100) {
        countIssue(issueSummary, 'invalid_value')
        continue
      }
      const depthFrom = finiteOrNull(row.depth_from)
      const depthTo = finiteOrNull(row.depth_to)
      if (!validDepths(depthFrom, depthTo)) {
        countIssue(issueSummary, 'invalid_depth')
        continue
      }
      observations.push({
        sourceId: row.id,
        holeId: row.hole_id,
        depthFrom,
        depthTo,
        variableKey: variable.key,
        numericValue: rqd,
        textValue: null,
        categoryValue: null,
        booleanValue: null,
        datetimeValue: null,
        unit: variable.canonicalUnit,
        quality: accepted ? 'accepted' : 'raw',
        observedAt: isoOrNull(row.accepted_at),
      })
    }
    return { sourceRowCount: result.rows.length, observations, issueSummary }
  },
}

const sources: readonly SourceDefinition[] = [structureSource, coreRowSource]

async function ensureDataset(
  client: PoolClient,
  projectId: string,
  source: SourceDefinition,
): Promise<string> {
  const result = await client.query<{ id: string }>(`
    INSERT INTO datasets (
      project_id, name, description, producer_type, producer_name, source_system, spatial_support
    ) VALUES ($1, $2, $3, 'field', 'GeoEye Field', $4, $5)
    ON CONFLICT (project_id, name) DO UPDATE SET status = 'active'
    RETURNING id
  `, [projectId, source.dataset.name, source.dataset.description, source.sourceEntityType, source.dataset.spatialSupport])
  const id = result.rows[0]?.id
  if (id === undefined) throw new Error('PostgreSQL did not return the projection dataset id')
  return id
}

async function reconcileObservations(
  client: PoolClient,
  projectId: string,
  datasetId: string,
  sourceEntityType: string,
  observations: readonly DesiredObservation[],
): Promise<void> {
  for (let start = 0; start < observations.length; start += insertChunkSize) {
    const chunk = observations.slice(start, start + insertChunkSize)
    await client.query(`
      INSERT INTO observation_values (
        project_id, dataset_id, dataset_version_id, source_type, source_id, hole_id,
        depth_from, depth_to, variable_id, numeric_value, text_value, category_value,
        boolean_value, datetime_value, unit, quality, observed_at
      )
      SELECT $1, $2, NULL, $3, desired."sourceId",
             (SELECT hole.id FROM drill_holes AS hole
              WHERE hole.id = desired."holeId" AND hole.project_id = $1),
             desired."depthFrom", desired."depthTo", variable.id, desired."numericValue",
             desired."textValue", desired."categoryValue", desired."booleanValue",
             desired."datetimeValue", desired.unit, desired.quality, desired."observedAt"
      FROM jsonb_to_recordset($4::jsonb) AS desired(
        "sourceId" text, "holeId" uuid, "depthFrom" numeric, "depthTo" numeric,
        "variableKey" text, "numericValue" double precision, "textValue" text,
        "categoryValue" text, "booleanValue" boolean, "datetimeValue" timestamptz,
        unit text, quality text, "observedAt" timestamptz
      )
      JOIN variable_definitions AS variable ON variable.key = desired."variableKey"
      ON CONFLICT (
        dataset_id,
        COALESCE(dataset_version_id, '${nullVersion}'::uuid),
        source_type,
        source_id,
        variable_id
      )
      DO UPDATE SET
        hole_id = EXCLUDED.hole_id,
        depth_from = EXCLUDED.depth_from,
        depth_to = EXCLUDED.depth_to,
        numeric_value = EXCLUDED.numeric_value,
        text_value = EXCLUDED.text_value,
        category_value = EXCLUDED.category_value,
        boolean_value = EXCLUDED.boolean_value,
        datetime_value = EXCLUDED.datetime_value,
        unit = EXCLUDED.unit,
        quality = EXCLUDED.quality,
        observed_at = EXCLUDED.observed_at
      WHERE (
        observation_values.hole_id, observation_values.depth_from, observation_values.depth_to,
        observation_values.numeric_value, observation_values.text_value,
        observation_values.category_value, observation_values.boolean_value,
        observation_values.datetime_value, observation_values.unit,
        observation_values.quality, observation_values.observed_at
      ) IS DISTINCT FROM (
        EXCLUDED.hole_id, EXCLUDED.depth_from, EXCLUDED.depth_to,
        EXCLUDED.numeric_value, EXCLUDED.text_value,
        EXCLUDED.category_value, EXCLUDED.boolean_value,
        EXCLUDED.datetime_value, EXCLUDED.unit,
        EXCLUDED.quality, EXCLUDED.observed_at
      )
    `, [projectId, datasetId, sourceEntityType, JSON.stringify(chunk)])
  }

  // Remove live observations Field no longer exposes (deleted, unaccepted, or unbound).
  await client.query(`
    DELETE FROM observation_values AS observation
    WHERE observation.dataset_id = $1
      AND observation.dataset_version_id IS NULL
      AND observation.source_type = $2
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_to_recordset($3::jsonb) AS desired("sourceId" text, "variableKey" text)
        JOIN variable_definitions AS variable ON variable.key = desired."variableKey"
        WHERE desired."sourceId" = observation.source_id
          AND variable.id = observation.variable_id
      )
  `, [
    datasetId,
    sourceEntityType,
    JSON.stringify(observations.map(({ sourceId, variableKey }) => ({ sourceId, variableKey }))),
  ])

  await client.query(`
    INSERT INTO dataset_variables (dataset_id, variable_id)
    SELECT DISTINCT $1::uuid, variable_id
    FROM observation_values
    WHERE dataset_id = $1
    ON CONFLICT DO NOTHING
  `, [datasetId])
}

async function projectSource(
  pool: Pool,
  projectId: string,
  source: SourceDefinition,
  options: Required<ProjectionOptions>,
): Promise<ProjectionSourceResult> {
  const empty = {
    sourceEntityType: source.sourceEntityType,
    datasetId: null,
    sourceRowCount: 0,
    observationCount: 0,
    issueCount: 0,
    issueSummary: {},
  }
  const client = await pool.connect()
  try {
    const reason = await source.unavailable(client)
    if (reason !== null) return { ...empty, outcome: 'skipped', message: reason }

    await client.query('BEGIN')
    try {
      const lock = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_xact_lock(hashtextextended($1::text, 0)) AS locked',
        [`geoeye_projection:${projectId}:${source.sourceEntityType}`],
      )
      if (lock.rows[0]?.locked !== true) {
        await client.query('ROLLBACK')
        return { ...empty, outcome: 'skipped', message: 'Another projection run holds this source' }
      }

      const fingerprint = await source.fingerprint(client, projectId, options)
      const checkpoint = await client.query<{
        dataset_id: string | null
        source_fingerprint: string | null
        source_row_count: string
        observation_count: string
        issue_count: string
        issue_summary_json: Record<string, number>
        last_status: string
      }>(`
        SELECT dataset_id, source_fingerprint, source_row_count::text, observation_count::text,
               issue_count::text, issue_summary_json, last_status
        FROM projection_checkpoints
        WHERE project_id = $1 AND source_entity_type = $2
      `, [projectId, source.sourceEntityType])
      const previous = checkpoint.rows[0]

      if (
        !options.force
        && previous !== undefined
        && previous.last_status === 'ok'
        && previous.dataset_id !== null
        && previous.source_fingerprint === fingerprint
      ) {
        await client.query(`
          UPDATE projection_checkpoints SET last_run_at = now()
          WHERE project_id = $1 AND source_entity_type = $2
        `, [projectId, source.sourceEntityType])
        await client.query('COMMIT')
        return {
          sourceEntityType: source.sourceEntityType,
          outcome: 'unchanged',
          datasetId: previous.dataset_id,
          sourceRowCount: Number(previous.source_row_count),
          observationCount: Number(previous.observation_count),
          issueCount: Number(previous.issue_count),
          issueSummary: previous.issue_summary_json,
          message: null,
        }
      }

      const projected = await source.project(client, projectId, options)
      // Two bindings may target one variable. A source row can hold only one value
      // per variable, so the first binding wins and the clash is reported.
      const seen = new Set<string>()
      projected.observations = projected.observations.filter((observation) => {
        const key = `${observation.sourceId}\u0000${observation.variableKey}`
        if (seen.has(key)) {
          countIssue(projected.issueSummary, 'duplicate_binding')
          return false
        }
        seen.add(key)
        return true
      })
      const datasetId = await ensureDataset(client, projectId, source)
      await reconcileObservations(client, projectId, datasetId, source.sourceEntityType, projected.observations)

      const observationCount = projected.observations.length
      const issueCount = Object.values(projected.issueSummary).reduce((sum, count) => sum + count, 0)
      await client.query(`
        INSERT INTO dataset_versions (dataset_id, version, content_hash, record_count, snapshot_at)
        SELECT id, current_version, $2, $3, now() FROM datasets WHERE id = $1
        ON CONFLICT (dataset_id, version) DO UPDATE SET
          content_hash = EXCLUDED.content_hash,
          record_count = EXCLUDED.record_count,
          snapshot_at = EXCLUDED.snapshot_at
      `, [datasetId, fingerprint, observationCount])
      await client.query(`
        INSERT INTO projection_checkpoints (
          project_id, source_entity_type, dataset_id, source_fingerprint, source_row_count,
          observation_count, issue_count, issue_summary_json, last_status, last_error,
          last_run_at, last_changed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'ok', NULL, now(), now())
        ON CONFLICT (project_id, source_entity_type) DO UPDATE SET
          dataset_id = EXCLUDED.dataset_id,
          source_fingerprint = EXCLUDED.source_fingerprint,
          source_row_count = EXCLUDED.source_row_count,
          observation_count = EXCLUDED.observation_count,
          issue_count = EXCLUDED.issue_count,
          issue_summary_json = EXCLUDED.issue_summary_json,
          last_status = 'ok',
          last_error = NULL,
          last_run_at = now(),
          last_changed_at = now()
      `, [
        projectId, source.sourceEntityType, datasetId, fingerprint, projected.sourceRowCount,
        observationCount, issueCount, JSON.stringify(projected.issueSummary),
      ])
      await client.query('COMMIT')
      return {
        sourceEntityType: source.sourceEntityType,
        outcome: 'projected',
        datasetId,
        sourceRowCount: projected.sourceRowCount,
        observationCount,
        issueCount,
        issueSummary: projected.issueSummary,
        message: null,
      }
    } catch (error) {
      await client.query('ROLLBACK')
      const message = error instanceof Error ? error.message : String(error)
      // Record the failure outside the rolled-back transaction so it is visible to operators.
      await client.query(`
        INSERT INTO projection_checkpoints (
          project_id, source_entity_type, last_status, last_error, last_run_at
        ) VALUES ($1, $2, 'failed', $3, now())
        ON CONFLICT (project_id, source_entity_type) DO UPDATE SET
          last_status = 'failed', last_error = EXCLUDED.last_error, last_run_at = now()
      `, [projectId, source.sourceEntityType, message.slice(0, 2_000)]).catch(() => undefined)
      return { ...empty, outcome: 'failed', message }
    }
  } finally {
    client.release()
  }
}

/** Projects every Field source of one project. Never throws for a single failed source. */
export async function runProjectProjection(
  pool: Pool,
  projectId: string,
  options: ProjectionOptions = {},
): Promise<ProjectionRunResult> {
  const resolved = { force: options.force ?? false, includeUnaccepted: options.includeUnaccepted ?? false }
  const known = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)
    && (await pool.query(`
      SELECT 1
      FROM projects AS project
      WHERE project.id = $1
        AND COALESCE((to_jsonb(project) ->> 'is_active')::boolean, true)
    `, [projectId])).rowCount === 1
  if (!known) {
    return {
      projectId,
      sources: sources.map((source) => ({
        sourceEntityType: source.sourceEntityType,
        outcome: 'failed' as const,
        datasetId: null,
        sourceRowCount: 0,
        observationCount: 0,
        issueCount: 0,
        issueSummary: {},
        message: `Project ${projectId} was not found`,
      })),
    }
  }
  const results: ProjectionSourceResult[] = []
  for (const source of sources) {
    results.push(await projectSource(pool, projectId, source, resolved))
  }
  return { projectId, sources: results }
}

/** Projects every project in the database, one at a time. */
export async function runAllProjections(
  pool: Pool,
  options: ProjectionOptions = {},
): Promise<ProjectionRunResult[]> {
  const projects = await pool.query<{ id: string }>(`
    SELECT project.id::text AS id
    FROM projects AS project
    WHERE COALESCE((to_jsonb(project) ->> 'is_active')::boolean, true)
    ORDER BY project.id
  `)
  const results: ProjectionRunResult[] = []
  for (const project of projects.rows) {
    results.push(await runProjectProjection(pool, project.id, options))
  }
  return results
}

export function projectionFailed(results: readonly ProjectionRunResult[]): boolean {
  return results.some((result) => result.sources.some((source) => source.outcome === 'failed'))
}
