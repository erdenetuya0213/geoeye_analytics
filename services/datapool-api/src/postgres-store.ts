import {
  OBSERVATION_QUERY_DEFAULT_LIMIT,
  type AnalysisResultPackageQuery,
  type AnalysisResultPackageRecord,
  type AnalysisRun,
  type Collar,
  type CollarInput,
  type SaveAnalysisResultPackageInput,
  type SavedAnalysisResultPackage,
  type Dataset,
  type DerivedValueInput,
  type DrillholeSummary,
  type FieldLoggingDataset,
  type FieldLoggingOverview,
  type FieldLoggingStructure,
  type FieldLoggingSubmission,
  type ObservationQuery,
  type ObservationValue,
  type ProjectSummary,
  type ProjectionBinding,
  type ProjectionBindingInput,
  type ProjectionRunResult,
  type ProjectionStatus,
  type ReplaceSurveysInput,
  type SurveyStation,
  type TabularImportInput,
  type TabularImportResult,
  type VariableDefinition,
} from '@geoeye/types'
import { Pool, type PoolClient, type PoolConfig } from 'pg'
import type { LoginAccount, ProjectPermission, UserAccess } from './auth.js'
import { conflict, notFound } from './errors.js'
import {
  generatedLoggingDataset,
  generatedLoggingDatasetId,
  generatedLoggingTemplateVersion,
} from './generated-logging.js'
import { liveLoggingColumn, mergeLiveLoggingColumn } from './live-logging.js'
import { runProjectProjection } from './projection.js'
import type { CreateAnalysisRunInput } from './schemas.js'
import type { DataPoolStore } from './store.js'

type SqlValue = string | number | boolean | Date | null | string[]

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value)
}

function nullableNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value)
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value !== 'string') return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

const tabularImportLabels = {
  laboratory: { name: 'Laboratory CSV imports', producerName: 'Laboratory', producerType: 'laboratory' as const, spatialSupport: 'interval' as const },
  spectral: { name: 'Spectral CSV imports', producerName: 'Core scanner', producerType: 'instrument' as const, spatialSupport: 'point' as const },
  strength: { name: 'Strength CSV imports', producerName: 'Strength laboratory', producerType: 'laboratory' as const, spatialSupport: 'interval' as const },
  xrf: { name: 'XRF CSV imports', producerName: 'Portable XRF', producerType: 'instrument' as const, spatialSupport: 'point' as const },
} satisfies Record<TabularImportInput['section'], { name: string; producerName: string; producerType: Dataset['producerType']; spatialSupport: Dataset['spatialSupport'] }>

function normalizedImportHeader(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, '')
}

function importHeaderIndex(columns: readonly string[], aliases: readonly string[]): number {
  return columns.findIndex((column) => aliases.includes(normalizedImportHeader(column)))
}

function importVariableSlug(value: string, index: number): string {
  const slug = value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const safe = /^[a-z]/.test(slug) ? slug : `column_${slug || index + 1}`
  return safe.slice(0, 48)
}

function firstFinite(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = finiteNumber(record[key])
    if (value !== null) return value
  }
  return null
}

interface AnalysisRunRow {
  id: string
  project_id: string
  analysis_type: string
  algorithm_version: string
  dataset_snapshot: Record<string, unknown>
  parameters_json: Record<string, unknown>
  created_by: string | null
  created_at: Date | string
  status: AnalysisRun['status']
}

interface AnalysisResultPackageRow {
  id: string
  tenant_key: string
  project_id: string
  dataset_id: string
  analysis_run_id: string
  feature: AnalysisResultPackageRecord['feature']
  template_version: number
  source_file_name: string
  input_name: string
  analysis_file_key: string
  derived_field_keys: string[]
  created_at: Date | string
}

interface AnalysisResultArtifactRow {
  id: string
  result_package_id: string
  borehole_id: string | null
  artifact_type: AnalysisResultPackageRecord['artifacts'][number]['artifactType']
  object_key: string
  file_name: string
  media_type: AnalysisResultPackageRecord['artifacts'][number]['mediaType']
  byte_size: string | number | null
  checksum_sha256: string | null
  metadata_json: Record<string, unknown>
}

interface CollarRow {
  easting: number
  northing: number
  elevation: number
  latitude: number | null
  longitude: number | null
  authority: string
  code: string
  crs_name: string
  survey_method: string | null
  accuracy: number | null
  source: string
  updated_at: Date | string
}

function mapCollar(row: CollarRow): Collar {
  return {
    easting: row.easting,
    northing: row.northing,
    elevation: row.elevation,
    latitude: row.latitude,
    longitude: row.longitude,
    crs: { authority: row.authority, code: row.code, name: row.crs_name },
    surveyMethod: row.survey_method,
    accuracy: row.accuracy,
    source: row.source,
    updatedAt: iso(row.updated_at),
  }
}

function mapAnalysisRun(row: AnalysisRunRow): AnalysisRun {
  return {
    id: row.id,
    projectId: row.project_id,
    analysisType: row.analysis_type,
    algorithmVersion: row.algorithm_version,
    datasetSnapshot: row.dataset_snapshot,
    parameters: row.parameters_json,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    status: row.status,
  }
}

export interface PostgresDataPoolStoreOptions {
  /** Project draft and flagged Field rows too, tagged with their quality. */
  projectionIncludeUnaccepted?: boolean
}

export class PostgresDataPoolStore implements DataPoolStore {
  readonly #pool: Pool
  readonly #projectionIncludeUnaccepted: boolean

  constructor(config: PoolConfig | Pool, options: PostgresDataPoolStoreOptions = {}) {
    this.#pool = config instanceof Pool ? config : new Pool(config)
    this.#projectionIncludeUnaccepted = options.projectionIncludeUnaccepted ?? false
  }

  async listVariables(): Promise<VariableDefinition[]> {
    const result = await this.#pool.query<{
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
      ORDER BY key
    `)

    return result.rows.map((row) => ({
      key: row.key,
      displayName: row.display_name,
      description: row.description,
      dataType: row.data_type,
      canonicalUnit: row.canonical_unit,
      origin: row.origin,
      spatialSupport: row.spatial_support,
      compatibleAnalyses: row.compatible_analyses,
    }))
  }

  async listDatasets(projectId: string): Promise<Dataset[]> {
    const result = await this.#pool.query<{
      id: string
      project_id: string
      name: string
      description: string | null
      producer_type: Dataset['producerType']
      producer_name: string
      source_system: string | null
      spatial_support: Dataset['spatialSupport']
      status: Dataset['status']
      current_version: number
      created_at: Date | string
      updated_at: Date | string
    }>(`
      SELECT id, project_id, name, description, producer_type, producer_name,
             source_system, spatial_support, status, current_version, created_at, updated_at
      FROM datasets
      WHERE project_id = $1
      ORDER BY name, id
    `, [projectId])

    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      producerType: row.producer_type,
      producerName: row.producer_name,
      sourceSystem: row.source_system,
      spatialSupport: row.spatial_support,
      status: row.status,
      currentVersion: row.current_version,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }))
  }

  async queryObservations(query: ObservationQuery): Promise<ObservationValue[]> {
    const structuresReadable = await this.#tableReadable('logging_structures')
    const sourceTemplateSelect = structuresReadable
      ? `to_jsonb(structure_source) ->> 'template_id' AS source_template_id`
      : 'NULL::text AS source_template_id'
    const sourceTemplateJoin = structuresReadable
      ? `LEFT JOIN logging_structures AS structure_source
           ON observation.source_type = 'field.logging_structure'
          AND structure_source.id::text = observation.source_id
          AND structure_source.project_id = observation.project_id`
      : ''
    const values: SqlValue[] = [query.projectId, query.variableKeys]
    const predicates = [
      'observation.project_id = $1',
      'variable.key = ANY($2::text[])',
    ]

    if (query.datasetIds !== undefined) {
      values.push(query.datasetIds)
      predicates.push(`observation.dataset_id = ANY($${values.length}::uuid[])`)
    }
    if (query.holeIds !== undefined) {
      values.push(query.holeIds)
      predicates.push(`observation.hole_id = ANY($${values.length}::uuid[])`)
    }
    if (query.depthFrom !== undefined) {
      values.push(query.depthFrom)
      predicates.push(`COALESCE(observation.depth_to, observation.depth_from) >= $${values.length}`)
    }
    if (query.depthTo !== undefined) {
      values.push(query.depthTo)
      predicates.push(`COALESCE(observation.depth_from, observation.depth_to) <= $${values.length}`)
    }
    if (query.acceptedOnly) predicates.push("observation.quality = 'accepted'")
    values.push(query.limit ?? OBSERVATION_QUERY_DEFAULT_LIMIT, query.offset ?? 0)
    const limitParameter = values.length - 1

    const result = await this.#pool.query<{
      id: string
      project_id: string
      dataset_id: string
      dataset_version_id: string | null
      source_type: string
      source_id: string
      source_template_id: string | null
      hole_id: string | null
      depth_from: string | number | null
      depth_to: string | number | null
      variable_key: string
      numeric_value: number | null
      text_value: string | null
      category_value: string | null
      boolean_value: boolean | null
      datetime_value: Date | string | null
      unit: string | null
      quality: ObservationValue['quality']
      observed_at: Date | string | null
    }>(`
      SELECT observation.id, observation.project_id, observation.dataset_id,
             observation.dataset_version_id, observation.source_type, observation.source_id,
             ${sourceTemplateSelect},
             observation.hole_id, observation.depth_from, observation.depth_to,
             variable.key AS variable_key, observation.numeric_value, observation.text_value,
             observation.category_value, observation.boolean_value, observation.datetime_value,
             observation.unit, observation.quality, observation.observed_at
      FROM observation_values AS observation
      JOIN variable_definitions AS variable ON variable.id = observation.variable_id
      ${sourceTemplateJoin}
      WHERE ${predicates.join('\n        AND ')}
      ORDER BY observation.hole_id NULLS LAST, observation.depth_from NULLS LAST,
               variable.key, observation.id
      LIMIT $${limitParameter} OFFSET $${limitParameter + 1}
    `, values)

    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      datasetId: row.dataset_id,
      datasetVersionId: row.dataset_version_id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceTemplateId: row.source_template_id,
      holeId: row.hole_id,
      depthFrom: nullableNumber(row.depth_from),
      depthTo: nullableNumber(row.depth_to),
      variableKey: row.variable_key,
      numericValue: row.numeric_value,
      textValue: row.text_value,
      categoryValue: row.category_value,
      booleanValue: row.boolean_value,
      datetimeValue: nullableIso(row.datetime_value),
      unit: row.unit,
      quality: row.quality,
      observedAt: nullableIso(row.observed_at),
    }))
  }

  async saveTabularImport(projectId: string, input: TabularImportInput, createdBy: string | null): Promise<TabularImportResult> {
    return this.#transaction(async (client) => {
      const config = tabularImportLabels[input.section]
      const datasetResult = await client.query<{
        id: string
        project_id: string
        name: string
        description: string | null
        producer_type: Dataset['producerType']
        producer_name: string
        source_system: string | null
        spatial_support: Dataset['spatialSupport']
        status: Dataset['status']
        current_version: number
        created_at: Date | string
        updated_at: Date | string
      }>(`
        INSERT INTO datasets (
          project_id, name, description, producer_type, producer_name,
          source_system, spatial_support, status, current_version, created_by
        ) VALUES ($1, $2, $3, $4, $5, 'geoeye.analytics.csv', $6, 'active', 1, $7)
        ON CONFLICT (project_id, name) DO UPDATE SET
          current_version = datasets.current_version + 1,
          description = EXCLUDED.description,
          producer_type = EXCLUDED.producer_type,
          producer_name = EXCLUDED.producer_name,
          source_system = EXCLUDED.source_system,
          spatial_support = EXCLUDED.spatial_support,
          status = 'active',
          updated_at = now()
        RETURNING id, project_id, name, description, producer_type, producer_name,
                  source_system, spatial_support, status, current_version, created_at, updated_at
      `, [
        projectId,
        config.name,
        `Explicitly saved ${input.section} CSV imports from GeoEye Analytics.`,
        config.producerType,
        config.producerName,
        config.spatialSupport,
        createdBy,
      ])
      const datasetRow = datasetResult.rows[0]
      if (datasetRow === undefined) throw new Error('PostgreSQL did not return the imported dataset')

      const versionResult = await client.query<{ id: string }>(`
        INSERT INTO dataset_versions (
          dataset_id, version, record_count, schema_json, source_object_key, created_by
        ) VALUES ($1, $2, $3, $4::jsonb, NULL, $5)
        RETURNING id
      `, [
        datasetRow.id,
        datasetRow.current_version,
        input.rows.length,
        JSON.stringify({ columns: input.columns, fileName: input.fileName, section: input.section }),
        createdBy,
      ])
      const datasetVersionId = versionResult.rows[0]?.id
      if (datasetVersionId === undefined) throw new Error('PostgreSQL did not return the imported dataset version')

      const holeIndex = importHeaderIndex(input.columns, ['holeid', 'borehole', 'hole', 'drillhole', 'drillholeid'])
      const fromIndex = importHeaderIndex(input.columns, ['from', 'fromm', 'depthfrom', 'depthfromm'])
      const toIndex = importHeaderIndex(input.columns, ['to', 'tom', 'depthto', 'depthtom'])
      const locationColumns = new Set([holeIndex, fromIndex, toIndex].filter((index) => index >= 0))
      const holeRows = await client.query<{ id: string; name: string }>(`
        SELECT id, name FROM drill_holes WHERE project_id = $1
      `, [projectId])
      const holesByName = new Map(holeRows.rows.map((hole) => [normalizedImportHeader(hole.name), hole.id]))
      const unmatchedHoles = new Set<string>()
      const usedVariableKeys = new Set<string>()
      const variables: Array<{ columnIndex: number; dataType: 'numeric' | 'text'; id: string }> = []

      for (let columnIndex = 0; columnIndex < input.columns.length; columnIndex += 1) {
        if (locationColumns.has(columnIndex)) continue
        const populated = input.rows.map((row) => (row[columnIndex] ?? '').trim()).filter((value) => value.length > 0)
        if (populated.length === 0) continue
        const dataType = populated.every((value) => Number.isFinite(Number(value))) ? 'numeric' as const : 'text' as const
        const base = `${input.section}.${importVariableSlug(input.columns[columnIndex] ?? '', columnIndex)}`
        let variableKey = base
        let suffix = 2
        while (usedVariableKeys.has(variableKey)) {
          variableKey = `${base}_${suffix}`
          suffix += 1
        }
        usedVariableKeys.add(variableKey)
        const variableResult = await client.query<{ id: string }>(`
          INSERT INTO variable_definitions (
            key, display_name, description, data_type, canonical_unit,
            origin, spatial_support, compatible_analyses, metadata_json
          ) VALUES ($1, $2, $3, $4, NULL, 'primary', $5, '{}', $6::jsonb)
          ON CONFLICT (key) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            description = EXCLUDED.description,
            data_type = EXCLUDED.data_type,
            spatial_support = EXCLUDED.spatial_support,
            metadata_json = EXCLUDED.metadata_json
          RETURNING id
        `, [
          variableKey,
          input.columns[columnIndex],
          `${config.name} column imported from ${input.fileName}.`,
          dataType,
          config.spatialSupport,
          JSON.stringify({ importSection: input.section, sourceColumn: input.columns[columnIndex] }),
        ])
        const variableId = variableResult.rows[0]?.id
        if (variableId === undefined) throw new Error(`PostgreSQL did not return variable ${variableKey}`)
        await client.query(`
          INSERT INTO dataset_variables (dataset_id, variable_id, source_name, source_unit)
          VALUES ($1, $2, $3, NULL)
          ON CONFLICT (dataset_id, variable_id) DO UPDATE SET source_name = EXCLUDED.source_name
        `, [datasetRow.id, variableId, input.columns[columnIndex]])
        variables.push({ columnIndex, dataType, id: variableId })
      }

      const observations: Array<Record<string, unknown>> = []
      input.rows.forEach((row, rowIndex) => {
        const rawHoleName = holeIndex < 0 ? '' : (row[holeIndex] ?? '').trim()
        const holeId = rawHoleName.length === 0 ? null : holesByName.get(normalizedImportHeader(rawHoleName)) ?? null
        if (rawHoleName.length > 0 && holeId === null) unmatchedHoles.add(rawHoleName)
        const rawFrom = fromIndex < 0 ? null : finiteNumber(row[fromIndex])
        const depthFrom = rawFrom !== null && rawFrom >= 0 ? rawFrom : null
        const rawTo = toIndex < 0 ? null : finiteNumber(row[toIndex])
        const depthTo = rawTo !== null && rawTo >= 0 && (depthFrom === null || rawTo >= depthFrom) ? rawTo : null
        variables.forEach((variable) => {
          const rawValue = (row[variable.columnIndex] ?? '').trim()
          if (rawValue.length === 0) return
          observations.push({
            boolean_value: null,
            category_value: null,
            datetime_value: null,
            depth_from: depthFrom,
            depth_to: depthTo,
            hole_id: holeId,
            numeric_value: variable.dataType === 'numeric' ? Number(rawValue) : null,
            source_id: `${input.fileName}:${rowIndex + 2}`,
            text_value: variable.dataType === 'text' ? rawValue : null,
            variable_id: variable.id,
          })
        })
      })

      await client.query('DELETE FROM observation_values WHERE dataset_id = $1', [datasetRow.id])
      if (observations.length > 0) {
        await client.query(`
          INSERT INTO observation_values (
            project_id, dataset_id, dataset_version_id, source_type, source_id,
            hole_id, depth_from, depth_to, variable_id, numeric_value, text_value,
            category_value, boolean_value, datetime_value, unit, quality, observed_at
          )
          SELECT $1, $2, $3, $4, record.source_id, record.hole_id, record.depth_from,
                 record.depth_to, record.variable_id, record.numeric_value, record.text_value,
                 record.category_value, record.boolean_value, record.datetime_value,
                 NULL, 'raw', NULL
          FROM jsonb_to_recordset($5::jsonb) AS record(
            source_id text, hole_id uuid, depth_from numeric, depth_to numeric,
            variable_id uuid, numeric_value double precision, text_value text,
            category_value text, boolean_value boolean, datetime_value timestamptz
          )
        `, [
          projectId,
          datasetRow.id,
          datasetVersionId,
          `analytics.csv.${input.section}`,
          JSON.stringify(observations),
        ])
      }

      return {
        dataset: {
          createdAt: iso(datasetRow.created_at),
          currentVersion: datasetRow.current_version,
          description: datasetRow.description,
          id: datasetRow.id,
          name: datasetRow.name,
          producerName: datasetRow.producer_name,
          producerType: datasetRow.producer_type,
          projectId: datasetRow.project_id,
          sourceSystem: datasetRow.source_system,
          spatialSupport: datasetRow.spatial_support,
          status: datasetRow.status,
          updatedAt: iso(datasetRow.updated_at),
        },
        importedRows: input.rows.length,
        observationCount: observations.length,
        unmatchedHoles: [...unmatchedHoles].sort((left, right) => left.localeCompare(right)),
        version: datasetRow.current_version,
      }
    })
  }

  async createAnalysisRun(
    input: CreateAnalysisRunInput,
    createdBy: string | null,
  ): Promise<AnalysisRun> {
    const result = await this.#pool.query<AnalysisRunRow>(`
      INSERT INTO analysis_runs (
        project_id, analysis_type, algorithm_version, dataset_snapshot, parameters_json, created_by
      ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
      RETURNING id, project_id, analysis_type, algorithm_version, dataset_snapshot,
                parameters_json, created_by, created_at, status
    `, [
      input.projectId,
      input.analysisType,
      input.algorithmVersion,
      JSON.stringify(input.datasetSnapshot),
      JSON.stringify(input.parameters),
      createdBy,
    ])
    const row = result.rows[0]
    if (row === undefined) throw new Error('PostgreSQL did not return the created analysis run')
    return mapAnalysisRun(row)
  }

  async saveDerivedValues(runId: string, values: DerivedValueInput[]): Promise<string[]> {
    return this.#transaction(async (client) => {
      const runResult = await client.query<{ project_id: string; status: AnalysisRun['status'] }>(`
        SELECT project_id, status
        FROM analysis_runs
        WHERE id = $1
        FOR UPDATE
      `, [runId])
      const run = runResult.rows[0]
      if (run === undefined) throw notFound(`Analysis run ${runId} was not found`)
      if (run.status !== 'draft' && run.status !== 'saved') {
        throw conflict(`Derived values cannot be added to an analysis run in ${run.status} status`)
      }
      if (values.some((value) => value.status === 'accepted' || value.status === 'superseded')) {
        throw conflict('New derived values must be in draft or saved status')
      }

      const variableKeys = [...new Set(values.map((value) => value.variableKey))]
      const variableResult = await client.query<{ id: string; key: string; origin: string }>(`
        SELECT id, key, origin
        FROM variable_definitions
        WHERE key = ANY($1::text[])
      `, [variableKeys])
      const variables = new Map(variableResult.rows.map((row) => [row.key, row]))
      for (const key of variableKeys) {
        const variable = variables.get(key)
        if (variable === undefined) throw notFound(`Variable ${key} was not found`)
        if (variable.origin !== 'derived' && variable.origin !== 'interpreted') {
          throw conflict(`Variable ${key} is not a derived or interpreted variable`)
        }
      }

      const observationIds = [...new Set(values.flatMap((value) => value.inputObservationIds))]
      const observationResult = await client.query<{ id: string }>(`
        SELECT id
        FROM observation_values
        WHERE project_id = $1 AND id = ANY($2::uuid[])
      `, [run.project_id, observationIds])
      if (observationResult.rowCount !== observationIds.length) {
        throw conflict('Every lineage observation must exist in the analysis run project')
      }

      const holeIds = [...new Set(
        values.flatMap((value) => value.holeId === null ? [] : [value.holeId]),
      )]
      if (holeIds.length > 0) {
        const holeResult = await client.query<{ id: string }>(`
          SELECT id
          FROM drill_holes
          WHERE project_id = $1 AND id = ANY($2::uuid[])
        `, [run.project_id, holeIds])
        if (holeResult.rowCount !== holeIds.length) {
          throw conflict('Every derived-value drillhole must exist in the analysis run project')
        }
      }

      const ids: string[] = []
      for (const value of values) {
        const variable = variables.get(value.variableKey)
        if (variable === undefined) throw new Error(`Variable ${value.variableKey} disappeared`)
        const derivedResult = await client.query<{ id: string }>(`
          INSERT INTO derived_values (
            analysis_run_id, variable_id, source_entity_type, source_entity_id, hole_id,
            depth_from, depth_to, numeric_value, text_value, category_value, confidence, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING id
        `, [
          runId,
          variable.id,
          value.sourceEntityType,
          value.sourceEntityId,
          value.holeId,
          value.depthFrom,
          value.depthTo,
          value.numericValue,
          value.textValue,
          value.categoryValue,
          value.confidence,
          value.status,
        ])
        const derivedId = derivedResult.rows[0]?.id
        if (derivedId === undefined) throw new Error('PostgreSQL did not return the derived value id')
        ids.push(derivedId)

        await client.query(`
          INSERT INTO derivation_inputs (derived_value_id, source_type, source_id)
          SELECT $1, 'observation_value', input_id::text
          FROM unnest($2::uuid[]) AS input_id
        `, [derivedId, [...new Set(value.inputObservationIds)]])
      }

      await client.query(`
        UPDATE analysis_runs
        SET status = 'saved', completed_at = COALESCE(completed_at, now())
        WHERE id = $1
      `, [runId])
      return ids
    })
  }

  async listAnalysisResultPackages(
    query: AnalysisResultPackageQuery,
  ): Promise<AnalysisResultPackageRecord[]> {
    const packages = await this.#pool.query<AnalysisResultPackageRow>(`
      SELECT package.id, package.tenant_key, package.project_id, package.dataset_id,
             package.analysis_run_id, package.feature, package.template_version,
             package.source_file_name, package.input_name, package.analysis_file_key,
             package.derived_field_keys, package.created_at
      FROM analysis_result_packages AS package
      WHERE package.tenant_key = $1
        AND package.project_id = $2
        AND ($3::uuid IS NULL OR package.dataset_id = $3)
        AND ($4::text IS NULL OR package.feature = $4)
        AND (
          $5::uuid IS NULL
          OR EXISTS (
            SELECT 1
            FROM analysis_result_artifacts AS scoped_artifact
            WHERE scoped_artifact.result_package_id = package.id
              AND (scoped_artifact.borehole_id = $5 OR scoped_artifact.borehole_id IS NULL)
          )
        )
      ORDER BY package.template_version DESC, package.updated_at DESC, package.id
    `, [
      query.tenantKey,
      query.projectId,
      query.datasetId ?? null,
      query.feature ?? null,
      query.boreholeId ?? null,
    ])
    if (packages.rows.length === 0) return []

    const artifacts = await this.#pool.query<AnalysisResultArtifactRow>(`
      SELECT id, result_package_id, borehole_id, artifact_type, object_key,
             file_name, media_type, byte_size, checksum_sha256, metadata_json
      FROM analysis_result_artifacts
      WHERE result_package_id = ANY($1::uuid[])
      ORDER BY result_package_id, artifact_type, file_name, id
    `, [packages.rows.map((item) => item.id)])
    const artifactsByPackage = new Map<string, AnalysisResultPackageRecord['artifacts']>()
    for (const artifact of artifacts.rows) {
      const mapped: AnalysisResultPackageRecord['artifacts'][number] = {
        id: artifact.id,
        boreholeId: artifact.borehole_id,
        artifactType: artifact.artifact_type,
        objectKey: artifact.object_key,
        fileName: artifact.file_name,
        mediaType: artifact.media_type,
        byteSize: artifact.byte_size === null ? null : Number(artifact.byte_size),
        checksumSha256: artifact.checksum_sha256,
        metadata: artifact.metadata_json,
      }
      const current = artifactsByPackage.get(artifact.result_package_id) ?? []
      current.push(mapped)
      artifactsByPackage.set(artifact.result_package_id, current)
    }

    return packages.rows.map((item) => {
      const packageArtifacts = artifactsByPackage.get(item.id) ?? []
      return {
        id: item.id,
        tenantKey: item.tenant_key,
        projectId: item.project_id,
        datasetId: item.dataset_id,
        analysisRunId: item.analysis_run_id,
        feature: item.feature,
        templateVersion: item.template_version,
        sourceFileName: item.source_file_name,
        inputName: item.input_name,
        analysisFileKey: item.analysis_file_key,
        derivedFieldKeys: item.derived_field_keys,
        artifactIds: packageArtifacts.map((artifact) => artifact.id),
        artifacts: packageArtifacts,
        createdAt: iso(item.created_at),
      }
    })
  }

  async saveAnalysisResultPackage(
    input: SaveAnalysisResultPackageInput,
    createdBy: string | null,
  ): Promise<SavedAnalysisResultPackage> {
    return this.#transaction(async (client) => {
      const ownership = await client.query<{ run_project_id: string; run_status: AnalysisRun['status']; dataset_project_id: string }>(`
        SELECT run.project_id AS run_project_id, run.status AS run_status,
               dataset.project_id AS dataset_project_id
        FROM analysis_runs AS run
        CROSS JOIN datasets AS dataset
        WHERE run.id = $1 AND dataset.id = $2
      `, [input.analysisRunId, input.datasetId])
      const owned = ownership.rows[0]
      if (owned === undefined) throw notFound('The analysis run or target logging dataset was not found')
      if (owned.run_project_id !== input.projectId || owned.dataset_project_id !== input.projectId) {
        throw conflict('The analysis run and target logging dataset must belong to the requested project')
      }
      if (owned.run_status !== 'saved' && owned.run_status !== 'accepted') {
        throw conflict(`An analysis result package requires a saved run; current status is ${owned.run_status}`)
      }

      const boreholeIds = [...new Set(input.artifacts.flatMap((artifact) => artifact.boreholeId === null ? [] : [artifact.boreholeId]))]
      if (boreholeIds.length > 0) {
        const boreholes = await client.query<{ id: string }>(`
          SELECT id FROM drill_holes
          WHERE project_id = $1 AND id = ANY($2::uuid[])
        `, [input.projectId, boreholeIds])
        if (boreholes.rowCount !== boreholeIds.length) {
          throw conflict('Every result artifact borehole must belong to the requested project')
        }
      }

      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
        [`${input.tenantKey}:${input.projectId}:${input.datasetId}`],
      )
      const currentVersionResult = await client.query<{ version: number }>(`
        SELECT COALESCE(max(template_version), 0)::integer AS version
        FROM analysis_result_packages
        WHERE tenant_key = $1 AND project_id = $2 AND dataset_id = $3
      `, [input.tenantKey, input.projectId, input.datasetId])
      const currentVersion = Math.max(
        input.fallbackTemplateVersion,
        currentVersionResult.rows[0]?.version ?? 0,
      )
      const templateVersion = input.mode === 'new-version' ? currentVersion + 1 : currentVersion

      for (const artifact of input.artifacts) {
        const boreholeSegment = artifact.boreholeId ?? '_all-boreholes'
        const expectedPrefix = `tenants/${input.tenantKey}/projects/${input.projectId}/boreholes/${boreholeSegment}/analytics/${input.feature}/v${templateVersion}/`
        if (!artifact.objectKey.startsWith(expectedPrefix) || !artifact.objectKey.endsWith(`/${artifact.fileName}`)) {
          throw conflict(`Artifact objectKey must use the resolved tenant/project/borehole hierarchy for template v${templateVersion}`)
        }
      }

      const existing = await client.query<{ analysis_run_id: string }>(`
        SELECT analysis_run_id
        FROM analysis_result_packages
        WHERE tenant_key = $1 AND project_id = $2 AND dataset_id = $3
          AND feature = $4 AND template_version = $5
        FOR UPDATE
      `, [input.tenantKey, input.projectId, input.datasetId, input.feature, templateVersion])
      const previousRunId = existing.rows[0]?.analysis_run_id

      const packageResult = await client.query<{ id: string; created_at: Date | string }>(`
        INSERT INTO analysis_result_packages (
          tenant_key, project_id, dataset_id, analysis_run_id, feature,
          template_version, source_file_name, input_name, analysis_file_key,
          derived_field_keys, metadata_json, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text[], $11::jsonb, $12)
        ON CONFLICT (tenant_key, project_id, dataset_id, feature, template_version)
        DO UPDATE SET
          analysis_run_id = EXCLUDED.analysis_run_id,
          source_file_name = EXCLUDED.source_file_name,
          input_name = EXCLUDED.input_name,
          analysis_file_key = EXCLUDED.analysis_file_key,
          derived_field_keys = EXCLUDED.derived_field_keys,
          metadata_json = EXCLUDED.metadata_json,
          created_by = EXCLUDED.created_by
        RETURNING id, created_at
      `, [
        input.tenantKey, input.projectId, input.datasetId, input.analysisRunId,
        input.feature, templateVersion, input.sourceFileName, input.inputName,
        input.analysisFileKey, [...new Set(input.derivedFieldKeys)], JSON.stringify(input.metadata), createdBy,
      ])
      const savedPackage = packageResult.rows[0]
      if (savedPackage === undefined) throw new Error('PostgreSQL did not return the saved analysis result package')

      await client.query('DELETE FROM analysis_result_artifacts WHERE result_package_id = $1', [savedPackage.id])
      const artifactIds: string[] = []
      for (const artifact of input.artifacts) {
        const artifactResult = await client.query<{ id: string }>(`
          INSERT INTO analysis_result_artifacts (
            result_package_id, borehole_id, artifact_type, object_key, file_name,
            media_type, byte_size, checksum_sha256, metadata_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
          RETURNING id
        `, [
          savedPackage.id, artifact.boreholeId, artifact.artifactType, artifact.objectKey,
          artifact.fileName, artifact.mediaType, artifact.byteSize, artifact.checksumSha256,
          JSON.stringify(artifact.metadata),
        ])
        const artifactId = artifactResult.rows[0]?.id
        if (artifactId === undefined) throw new Error('PostgreSQL did not return the saved analysis artifact')
        artifactIds.push(artifactId)
      }

      if (previousRunId !== undefined && previousRunId !== input.analysisRunId) {
        await client.query(`
          UPDATE analysis_runs SET status = 'superseded'
          WHERE id = $1 AND status IN ('draft', 'saved')
        `, [previousRunId])
        await client.query(`
          UPDATE derived_values SET status = 'superseded'
          WHERE analysis_run_id = $1 AND status IN ('draft', 'saved')
        `, [previousRunId])
      }

      return {
        id: savedPackage.id,
        tenantKey: input.tenantKey,
        projectId: input.projectId,
        datasetId: input.datasetId,
        analysisRunId: input.analysisRunId,
        feature: input.feature,
        templateVersion,
        sourceFileName: input.sourceFileName,
        inputName: input.inputName,
        analysisFileKey: input.analysisFileKey,
        derivedFieldKeys: [...new Set(input.derivedFieldKeys)],
        artifactIds,
        createdAt: iso(savedPackage.created_at),
      }
    })
  }

  async acceptAnalysisRun(runId: string, acceptedBy: string | null): Promise<AnalysisRun> {
    return this.#transaction(async (client) => {
      const locked = await client.query<{ status: AnalysisRun['status'] }>(`
        SELECT status
        FROM analysis_runs
        WHERE id = $1
        FOR UPDATE
      `, [runId])
      const run = locked.rows[0]
      if (run === undefined) throw notFound(`Analysis run ${runId} was not found`)
      if (run.status !== 'saved') {
        throw conflict(`Only a saved analysis run can be accepted; current status is ${run.status}`)
      }

      const valueCount = await client.query<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM derived_values
        WHERE analysis_run_id = $1
      `, [runId])
      if (Number(valueCount.rows[0]?.count ?? 0) === 0) {
        throw conflict('An analysis run must contain derived values before it can be accepted')
      }

      await client.query(`
        UPDATE derived_values
        SET status = 'accepted'
        WHERE analysis_run_id = $1
      `, [runId])

      const updated = await client.query<AnalysisRunRow>(`
        UPDATE analysis_runs
        SET status = 'accepted', accepted_at = now(), accepted_by = $2
        WHERE id = $1
        RETURNING id, project_id, analysis_type, algorithm_version, dataset_snapshot,
                  parameters_json, created_by, created_at, status
      `, [runId, acceptedBy])
      const row = updated.rows[0]
      if (row === undefined) throw new Error('PostgreSQL did not return the accepted analysis run')
      return mapAnalysisRun(row)
    })
  }

  // Field owns `projects` and `drill_holes`. Their columns are read through
  // to_jsonb so the Data Pool tolerates the Field schema variants in circulation
  // (`name`/`title`, `hole_name`/`name`) instead of binding to one table layout.
  async listProjects(): Promise<ProjectSummary[]> {
    const organizations = await this.#tableExists('organizations')
    const deletions = await this.#deletionLedgerPresent()
    const currentHole = deletions
      ? `AND NOT EXISTS (
           SELECT 1 FROM depth_registration_deletions AS deletion
           WHERE deletion.entity_type = 'drill_holes' AND deletion.entity_id = hole.id
         )`
      : ''
    const result = await this.#pool.query<{
      id: string
      name: string
      description: string | null
      is_active: boolean
      drillhole_count: number
      organization_id: string | null
      organization_name: string | null
    }>(`
      SELECT project.id,
             COALESCE(
               NULLIF(btrim(to_jsonb(project) ->> 'name'), ''),
               NULLIF(btrim(to_jsonb(project) ->> 'title'), ''),
               project.id::text
             ) AS name,
             NULLIF(btrim(to_jsonb(project) ->> 'description'), '') AS description,
             COALESCE((to_jsonb(project) ->> 'is_active')::boolean, true) AS is_active,
             (SELECT count(*) FROM drill_holes AS hole
              WHERE hole.project_id = project.id ${currentHole})::integer
               AS drillhole_count,
             ${organizations ? 'organization.id' : 'NULL::uuid'} AS organization_id,
             ${organizations ? 'organization.name' : 'NULL::text'} AS organization_name
      FROM projects AS project
      ${organizations
        ? "LEFT JOIN organizations AS organization ON organization.id::text = to_jsonb(project) ->> 'organization_id'"
        : ''}
      WHERE COALESCE((to_jsonb(project) ->> 'is_active')::boolean, true)
      ORDER BY 2, 1
    `)
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      isActive: row.is_active,
      drillholeCount: row.drillhole_count,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      canWrite: true,
    }))
  }

  async listDrillholes(projectId: string): Promise<DrillholeSummary[]> {
    await this.#requireProject(this.#pool, projectId)
    const deletions = await this.#deletionLedgerPresent()
    const currentHole = deletions
      ? `AND NOT EXISTS (
           SELECT 1 FROM depth_registration_deletions AS deletion
           WHERE deletion.entity_type = 'drill_holes' AND deletion.entity_id = hole.id
         )`
      : ''
    const result = await this.#pool.query<CollarRow & {
      id: string
      project_id: string
      name: string
      collar_id: string | null
      survey_station_count: number
    }>(`
      SELECT hole.id, hole.project_id,
             COALESCE(
               NULLIF(btrim(to_jsonb(hole) ->> 'hole_name'), ''),
               NULLIF(btrim(to_jsonb(hole) ->> 'name'), ''),
               hole.id::text
             ) AS name,
             collar.id AS collar_id, collar.easting, collar.northing, collar.elevation,
             collar.latitude, collar.longitude, crs.authority, crs.code, crs.name AS crs_name,
             collar.survey_method, collar.accuracy, collar.source, collar.updated_at,
             (SELECT count(*) FROM drillhole_surveys AS survey WHERE survey.hole_id = hole.id)::integer
               AS survey_station_count
      FROM drill_holes AS hole
      LEFT JOIN drillhole_collars AS collar ON collar.hole_id = hole.id
      LEFT JOIN coordinate_reference_systems AS crs ON crs.id = collar.crs_id
      WHERE hole.project_id = $1
        ${currentHole}
      ORDER BY 3, 1
    `, [projectId])
    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      collar: row.collar_id === null ? null : mapCollar(row),
      surveyStationCount: row.survey_station_count,
    }))
  }

  /**
   * Reads the Field-owned source rows for the review workspace. This does not
   * project, accept, or mutate them; it only normalizes the established
   * Alpha/Beta field aliases into a stable API shape.
   */
  async listFieldLoggingStructures(projectId: string): Promise<FieldLoggingStructure[]> {
    await this.#requireProject(this.#pool, projectId)
    if (!await this.#tableReadable('logging_structures')) return []
    const dictionaryReadable = await this.#tableReadable('dictionary_items')
    const result = await this.#pool.query<{
      alpha_beta: unknown
      depth_from: number | string | null
      depth_to: number | string | null
      hole_id: string | null
      id: string
      orientation_status: string | null
      project_id: string
      review_status: string
      structure_type: string | null
      template_id: string | null
    }>(`
      SELECT structure.id::text AS id, structure.project_id::text AS project_id,
             structure.hole_id::text AS hole_id, structure.template_id::text AS template_id,
             structure.depth_from, structure.depth_to, structure.selections_json AS alpha_beta,
             structure.selections_json ->> '_orientation_status' AS orientation_status,
             COALESCE(
               ${dictionaryReadable ? "NULLIF(btrim(dictionary.name), ''), NULLIF(btrim(dictionary.code), '')," : ''}
               NULLIF(btrim(structure.structure_type), ''),
               NULLIF(btrim(structure.selections_json ->> 'discontinuity_type'), '')
             ) AS structure_type,
             structure.review_status
      FROM logging_structures AS structure
      ${dictionaryReadable
        ? `LEFT JOIN dictionary_items AS dictionary
             ON dictionary.id::text = COALESCE(
               NULLIF(btrim(structure.structure_type), ''),
               NULLIF(btrim(structure.selections_json ->> 'discontinuity_type'), '')
             )`
        : ''}
      WHERE structure.project_id = $1
      ORDER BY structure.hole_id NULLS LAST, structure.depth_from NULLS LAST, structure.id
    `, [projectId])

    return result.rows.map((row) => {
      const selections = objectValue(row.alpha_beta)
      const depthFrom = finiteNumber(row.depth_from)
        ?? firstFinite(selections, ['structure_depth_m', 'depth_m'])
      const depthTo = finiteNumber(row.depth_to)
      return {
        id: row.id,
        projectId: row.project_id,
        holeId: row.hole_id,
        templateId: row.template_id,
        depthFrom: depthFrom !== null && depthFrom >= 0 ? depthFrom : null,
        depthTo: depthTo !== null && depthTo >= 0 ? depthTo : null,
        alpha: firstFinite(selections, ['alpha_to_core_axis_deg', 'alpha']),
        beta: firstFinite(selections, ['beta_reference_deg', 'beta']),
        structureType: row.structure_type,
        orientationStatus: row.orientation_status,
        reviewStatus: row.review_status === 'accepted' || row.review_status === 'flagged'
          ? row.review_status
          : 'draft',
      }
    })
  }

  /** Active Field templates and the holes where each template contains logging data. */
  async listFieldLogging(projectId: string): Promise<FieldLoggingOverview> {
    await this.#requireProject(this.#pool, projectId)
    const [
      templatesPresent,
      assignmentsPresent,
      selectionsPresent,
      intervalsPresent,
      structuresPresent,
      generatedLogsPresent,
      coreRowsPresent,
      deletionsPresent,
    ] = await Promise.all([
      this.#tableReadable('logging_templates'),
      this.#tableReadable('logging_template_assignments'),
      this.#tableReadable('logging_row_selections'),
      this.#tableReadable('logging_intervals'),
      this.#tableReadable('logging_structures'),
      this.#tableReadable('generated_logs'),
      this.#tableReadable('core_rows'),
      this.#deletionLedgerPresent(),
    ])

    if (!templatesPresent) return { projectId, templates: [], submissions: [] }

    const assignedTemplate = assignmentsPresent
      ? `OR EXISTS (
           SELECT 1 FROM logging_template_assignments AS assignment
           WHERE assignment.project_id = $1 AND assignment.template_id = template.id
         )`
      : ''
    const templateResult = await this.#pool.query<{
      id: string
      name: string
      template_json: unknown
      updated_at: Date | string
      version: number | string
    }>(`
      SELECT template.id::text AS id,
             COALESCE(NULLIF(btrim(template.name), ''), template.id::text) AS name,
             COALESCE((to_jsonb(template) ->> 'version')::integer, 1) AS version,
             template.template_json, template.updated_at
      FROM logging_templates AS template
      WHERE COALESCE((to_jsonb(template) ->> 'is_active')::boolean, true)
        AND (template.project_id = $1 ${assignedTemplate})
      ORDER BY 2, 1
    `, [projectId])
    const templates = templateResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      version: Number(row.version),
    }))
    const templateById = new Map(templates.map((template) => [template.id, template]))

    const currentHole = deletionsPresent
      ? `AND NOT EXISTS (
           SELECT 1 FROM depth_registration_deletions AS deletion
           WHERE deletion.entity_type = 'drill_holes' AND deletion.entity_id = hole.id
         )`
      : ''
    const holeResult = await this.#pool.query<{ id: string; name: string }>(`
      SELECT hole.id::text AS id,
             COALESCE(
               NULLIF(btrim(to_jsonb(hole) ->> 'hole_name'), ''),
               NULLIF(btrim(to_jsonb(hole) ->> 'name'), ''),
               hole.id::text
             ) AS name
      FROM drill_holes AS hole
      WHERE hole.project_id = $1 ${currentHole}
      ORDER BY 2, 1
    `, [projectId])
    const holeById = new Map(holeResult.rows.map((hole) => [hole.id, hole.name]))

    interface SourceAggregate {
      hole_id: string
      template_id: string
      record_count: number | string
      depth_from: number | string | null
      depth_to: number | string | null
      updated_at: Date | string | null
    }
    type CountField = 'selectedRowCount' | 'intervalCount' | 'structureCount' | 'generatedLogCount'
    const summaries = new Map<string, FieldLoggingSubmission>()
    const merge = (row: SourceAggregate, countField: CountField) => {
      const template = templateById.get(row.template_id)
      const holeName = holeById.get(row.hole_id)
      if (template === undefined || holeName === undefined) return
      const key = `${row.hole_id}:${row.template_id}`
      const current = summaries.get(key) ?? {
        projectId,
        holeId: row.hole_id,
        holeName,
        templateId: template.id,
        templateName: template.name,
        templateVersion: template.version,
        depthFrom: null,
        depthTo: null,
        selectedRowCount: 0,
        intervalCount: 0,
        structureCount: 0,
        generatedLogCount: 0,
        updatedAt: null,
      }
      current[countField] += Number(row.record_count)
      const from = nullableNumber(row.depth_from)
      const to = nullableNumber(row.depth_to)
      if (from !== null) current.depthFrom = current.depthFrom === null ? from : Math.min(current.depthFrom, from)
      if (to !== null) current.depthTo = current.depthTo === null ? to : Math.max(current.depthTo, to)
      const updatedAt = nullableIso(row.updated_at)
      if (updatedAt !== null && (current.updatedAt === null || updatedAt > current.updatedAt)) current.updatedAt = updatedAt
      summaries.set(key, current)
    }
    const collect = async (query: Promise<{ rows: SourceAggregate[] }>, countField: CountField) => {
      const result = await query
      for (const row of result.rows) merge(row, countField)
    }
    const work: Promise<void>[] = []

    if (coreRowsPresent && selectionsPresent) {
      work.push(collect(this.#pool.query<SourceAggregate>(`
        SELECT row.hole_id::text AS hole_id, selection.template_id::text AS template_id,
               count(DISTINCT selection.row_id)::integer AS record_count,
               min(row.depth_from) AS depth_from, max(row.depth_to) AS depth_to,
               max(selection.updated_at) AS updated_at
        FROM logging_row_selections AS selection
        JOIN core_rows AS row ON row.id = selection.row_id AND row.project_id = selection.project_id
        WHERE selection.project_id = $1 AND selection.template_id IS NOT NULL
        GROUP BY row.hole_id, selection.template_id
      `, [projectId]), 'selectedRowCount'))
    }
    if (coreRowsPresent && intervalsPresent) {
      work.push(collect(this.#pool.query<SourceAggregate>(`
        SELECT row.hole_id::text AS hole_id, interval.template_id::text AS template_id,
               count(*)::integer AS record_count,
               min(interval.depth_from) AS depth_from, max(interval.depth_to) AS depth_to,
               max(interval.updated_at) AS updated_at
        FROM logging_intervals AS interval
        JOIN core_rows AS row ON row.id = interval.row_id AND row.project_id = interval.project_id
        WHERE interval.project_id = $1 AND interval.template_id IS NOT NULL
        GROUP BY row.hole_id, interval.template_id
      `, [projectId]), 'intervalCount'))
    }
    if (structuresPresent) {
      work.push(collect(this.#pool.query<SourceAggregate>(`
        SELECT structure.hole_id::text AS hole_id, structure.template_id::text AS template_id,
               count(*)::integer AS record_count,
               min(structure.depth_from) AS depth_from, max(structure.depth_to) AS depth_to,
               max(structure.updated_at) AS updated_at
        FROM logging_structures AS structure
        WHERE structure.project_id = $1 AND structure.hole_id IS NOT NULL AND structure.template_id IS NOT NULL
        GROUP BY structure.hole_id, structure.template_id
      `, [projectId]), 'structureCount'))
    }
    if (generatedLogsPresent) {
      work.push(collect(this.#pool.query<SourceAggregate>(`
        SELECT log.drill_hole_id::text AS hole_id, log.template_id::text AS template_id,
               count(*)::integer AS record_count,
               min(log.depth_from) AS depth_from, max(log.depth_to) AS depth_to,
               max(log.updated_at) AS updated_at
        FROM generated_logs AS log
        WHERE log.project_id = $1 AND log.drill_hole_id IS NOT NULL AND log.template_id IS NOT NULL
          AND log.status <> 'archived'
        GROUP BY log.drill_hole_id, log.template_id
      `, [projectId]), 'generatedLogCount'))
    }
    await Promise.all(work)

    const submissions = [...summaries.values()].sort((left, right) =>
      left.holeName.localeCompare(right.holeName)
      || left.templateName.localeCompare(right.templateName),
    )

    const datasets: FieldLoggingDataset[] = []
    if (coreRowsPresent && intervalsPresent) {
      type Column = FieldLoggingDataset['columns'][number]
      type Cell = FieldLoggingDataset['records'][number]['values'][string]
      interface IntervalRow {
        depth_from: number | string | null
        depth_to: number | string | null
        hole_id: string
        id: string
        row_id: string
        selections_json: unknown
        template_id: string
      }
      const fieldDefinitions = new Map<string, Map<string, Column>>()
      for (const templateRow of templateResult.rows) {
        const definitions = new Map<string, Column>()
        const classes = objectValue(templateRow.template_json).classes
        if (Array.isArray(classes)) {
          for (const rawClass of classes) {
            const fields = objectValue(rawClass).fields
            if (!Array.isArray(fields)) continue
            for (const rawField of fields) {
              const field = objectValue(rawField)
              const key = typeof field.id === 'string' ? field.id.trim() : ''
              const label = typeof field.label === 'string' ? field.label.trim() : ''
              if (key === '' || label === '') continue
              const type = typeof field.type === 'string' ? field.type.toLocaleLowerCase() : ''
              definitions.set(key, {
                dataType: type === 'number' || type === 'numeric'
                  ? 'numeric'
                  : type === 'dictionary' || type === 'category' || type === 'select'
                    ? 'category'
                    : type === 'boolean'
                      ? 'boolean'
                      : type === 'date' || type === 'datetime'
                        ? 'datetime'
                        : 'text',
                key,
                label,
                unit: typeof field.unit === 'string' && field.unit.trim() !== '' ? field.unit.trim() : null,
              })
            }
          }
        }
        fieldDefinitions.set(templateRow.id, definitions)
      }

      const dictionaryReadable = await this.#tableReadable('dictionary_items')
      const dictionaryById = new Map<string, string>()
      if (dictionaryReadable) {
        const dictionaryResult = await this.#pool.query<{ id: string; label: string }>(`
          SELECT item.id::text AS id,
                 COALESCE(NULLIF(btrim(item.name), ''), NULLIF(btrim(item.code), ''), item.id::text) AS label
          FROM dictionary_items AS item
        `)
        for (const item of dictionaryResult.rows) dictionaryById.set(item.id, item.label)
      }

      const intervalResult = await this.#pool.query<IntervalRow>(`
        SELECT interval.id::text AS id, interval.row_id::text AS row_id,
               interval.template_id::text AS template_id, row.hole_id::text AS hole_id,
               COALESCE(interval.depth_from, row.depth_from) AS depth_from,
               COALESCE(interval.depth_to, row.depth_to, interval.depth_from, row.depth_from) AS depth_to,
               interval.selections_json
        FROM logging_intervals AS interval
        JOIN core_rows AS row ON row.id = interval.row_id AND row.project_id = interval.project_id
        WHERE interval.project_id = $1 AND interval.template_id IS NOT NULL
        ORDER BY interval.updated_at, interval.id
      `, [projectId])

      const groupedByTemplate = new Map<string, Map<string, FieldLoggingDataset['records'][number]>>()
      const columnsByTemplate = new Map<string, Map<string, Column>>()
      for (const row of intervalResult.rows) {
        const definitions = fieldDefinitions.get(row.template_id) ?? new Map<string, Column>()
        const values = objectValue(row.selections_json)
        const depthFrom = finiteNumber(row.depth_from)
        const depthTo = finiteNumber(row.depth_to)
        const groupId = `${row.template_id}:${row.hole_id}:${row.row_id}:${depthFrom ?? 'none'}:${depthTo ?? 'none'}`
        const groups = groupedByTemplate.get(row.template_id) ?? new Map()
        const record = groups.get(groupId) ?? {
          depthFrom: depthFrom !== null && depthFrom >= 0 ? depthFrom : null,
          depthTo: depthTo !== null && depthTo >= 0 ? depthTo : null,
          holeId: row.hole_id,
          id: groupId,
          values: {},
        }
        const observedColumns = columnsByTemplate.get(row.template_id) ?? new Map<string, Column>()
        for (const [key, rawValue] of Object.entries(values)) {
          if (key.startsWith('_') || rawValue === undefined || (typeof rawValue === 'object' && rawValue !== null)) continue
          const definition = definitions.get(key) ?? liveLoggingColumn(key, rawValue)
          if (definition === undefined) continue
          const value: Cell = typeof rawValue === 'string' ? dictionaryById.get(rawValue) ?? rawValue : rawValue as Cell
          record.values[key] = value
          observedColumns.set(key, definitions.has(key) ? definition : mergeLiveLoggingColumn(observedColumns.get(key), definition))
        }
        groups.set(groupId, record)
        groupedByTemplate.set(row.template_id, groups)
        columnsByTemplate.set(row.template_id, observedColumns)
      }

      if (structuresPresent) {
        const structureResult = await this.#pool.query<{
          depth_from: number | string | null
          depth_to: number | string | null
          hole_id: string
          id: string
          selections_json: unknown
          template_id: string
        }>(`
          SELECT structure.id::text AS id, structure.template_id::text AS template_id,
                 structure.hole_id::text AS hole_id, structure.depth_from, structure.depth_to,
                 structure.selections_json
          FROM logging_structures AS structure
          WHERE structure.project_id = $1
            AND structure.template_id IS NOT NULL AND structure.hole_id IS NOT NULL
          ORDER BY structure.updated_at, structure.id
        `, [projectId])
        for (const row of structureResult.rows) {
          const definitions = fieldDefinitions.get(row.template_id) ?? new Map<string, Column>()
          const values = objectValue(row.selections_json)
          const depthFrom = finiteNumber(row.depth_from) ?? firstFinite(values, ['structure_depth_m', 'depth_m'])
          const depthTo = finiteNumber(row.depth_to) ?? depthFrom
          const groups = groupedByTemplate.get(row.template_id) ?? new Map()
          const record: FieldLoggingDataset['records'][number] = {
            depthFrom: depthFrom !== null && depthFrom >= 0 ? depthFrom : null,
            depthTo: depthTo !== null && depthTo >= 0 ? depthTo : null,
            holeId: row.hole_id,
            id: `${row.template_id}:structure:${row.id}`,
            values: {},
          }
          const observedColumns = columnsByTemplate.get(row.template_id) ?? new Map<string, Column>()
          for (const [key, rawValue] of Object.entries(values)) {
            if (key.startsWith('_') || rawValue === undefined || (typeof rawValue === 'object' && rawValue !== null)) continue
            const definition = definitions.get(key) ?? liveLoggingColumn(key, rawValue)
            if (definition === undefined) continue
            const value: Cell = typeof rawValue === 'string' ? dictionaryById.get(rawValue) ?? rawValue : rawValue as Cell
            record.values[key] = value
            observedColumns.set(key, definitions.has(key) ? definition : mergeLiveLoggingColumn(observedColumns.get(key), definition))
          }
          groups.set(record.id, record)
          groupedByTemplate.set(row.template_id, groups)
          columnsByTemplate.set(row.template_id, observedColumns)
        }
      }

      for (const templateRow of templateResult.rows) {
        const records = [...(groupedByTemplate.get(templateRow.id)?.values() ?? [])]
          .filter((record) => Object.keys(record.values).length > 0)
          .sort((left, right) => (left.holeId ?? '').localeCompare(right.holeId ?? '')
            || (left.depthFrom ?? Number.POSITIVE_INFINITY) - (right.depthFrom ?? Number.POSITIVE_INFINITY)
            || left.id.localeCompare(right.id))
        // Preserve the complete declared schema, including fields with no values yet.
        const columns = [...new Map([...(columnsByTemplate.get(templateRow.id) ?? []), ...(fieldDefinitions.get(templateRow.id) ?? [])]).values()]
          .sort((left, right) => left.label.localeCompare(right.label) || left.key.localeCompare(right.key))
        if (columns.length === 0) continue
        const category = objectValue(templateRow.template_json).category
        datasets.push({
          category: typeof category === 'string' && category.trim() !== '' ? category.trim() : null,
          columns,
          id: templateRow.id,
          name: templateRow.name,
          records,
          updatedAt: iso(templateRow.updated_at),
          version: Number(templateRow.version),
        })
      }
    }
    if (generatedLogsPresent) {
      const exports = await this.#pool.query<{
        id: string; template_id: string; hole_id: string; name: string; payload_json: unknown; updated_at: Date | string
      }>(`
        SELECT DISTINCT ON (log.template_id, log.drill_hole_id)
          log.id::text AS id, log.template_id::text AS template_id,
          log.drill_hole_id::text AS hole_id, log.name, log.payload_json, log.updated_at
        FROM generated_logs AS log
        WHERE log.project_id = $1 AND log.status <> 'archived'
          AND log.template_id IS NOT NULL AND log.drill_hole_id IS NOT NULL
          AND jsonb_typeof(log.payload_json -> 'csv') = 'string'
        ORDER BY log.template_id, log.drill_hole_id, log.updated_at DESC, log.id DESC
      `, [projectId])
      const generated = new Map<string, FieldLoggingDataset>()
      for (const log of exports.rows) {
        const template = templateById.get(log.template_id)
        if (template === undefined || !holeById.has(log.hole_id)) continue
        const payload = objectValue(log.payload_json)
        const csv = payload.csv
        if (typeof csv !== 'string') continue
        const version = generatedLoggingTemplateVersion(payload, template.version)
        const dataset = generatedLoggingDataset({ csv, holeId: log.hole_id,
          id: generatedLoggingDatasetId(log.template_id, version), name: `${template.name} · generated CSV`,
          updatedAt: iso(log.updated_at), version })
        const existing = generated.get(dataset.id)
        if (existing === undefined) generated.set(dataset.id, dataset)
        else {
          const columns = new Map(existing.columns.map(column => [column.key, column]))
          for (const column of dataset.columns) {
            if (columns.get(column.key)?.dataType !== 'numeric') columns.set(column.key, column)
          }
          existing.columns = [...columns.values()]
          existing.records.push(...dataset.records)
          if (dataset.updatedAt > existing.updatedAt) existing.updatedAt = dataset.updatedAt
        }
      }
      datasets.push(...generated.values())
    }
    return { datasets, projectId, templates, submissions }
  }

  async saveCollar(projectId: string, holeId: string, input: CollarInput): Promise<Collar> {
    return this.#transaction(async (client) => {
      await this.#requireDrillhole(client, projectId, holeId)
      const authority = input.crs.authority.toUpperCase()
      const crs = await client.query<{ id: string }>(`
        INSERT INTO coordinate_reference_systems (authority, code, name)
        VALUES ($1, $2, COALESCE($3, $1 || ':' || $2))
        ON CONFLICT (authority, code) DO UPDATE SET
          name = COALESCE($3, coordinate_reference_systems.name)
        RETURNING id
      `, [authority, input.crs.code, input.crs.name ?? null])
      const crsId = crs.rows[0]?.id
      if (crsId === undefined) throw new Error('PostgreSQL did not return the coordinate reference system')

      const saved = await client.query<CollarRow>(`
        WITH saved AS (
          INSERT INTO drillhole_collars (
            project_id, hole_id, easting, northing, elevation, latitude, longitude,
            crs_id, survey_method, accuracy, source
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (hole_id) DO UPDATE SET
            project_id = EXCLUDED.project_id,
            easting = EXCLUDED.easting,
            northing = EXCLUDED.northing,
            elevation = EXCLUDED.elevation,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            crs_id = EXCLUDED.crs_id,
            survey_method = EXCLUDED.survey_method,
            accuracy = EXCLUDED.accuracy,
            source = EXCLUDED.source
          RETURNING *
        )
        SELECT saved.easting, saved.northing, saved.elevation, saved.latitude, saved.longitude,
               crs.authority, crs.code, crs.name AS crs_name, saved.survey_method,
               saved.accuracy, saved.source, saved.updated_at
        FROM saved
        JOIN coordinate_reference_systems AS crs ON crs.id = saved.crs_id
      `, [
        projectId, holeId, input.easting, input.northing, input.elevation, input.latitude,
        input.longitude, crsId, input.surveyMethod, input.accuracy, input.source,
      ])
      const row = saved.rows[0]
      if (row === undefined) throw new Error('PostgreSQL did not return the saved collar')
      return mapCollar(row)
    })
  }

  async listSurveys(projectId: string, holeId: string): Promise<SurveyStation[]> {
    await this.#requireDrillhole(this.#pool, projectId, holeId)
    return this.#selectSurveys(this.#pool, holeId)
  }

  async replaceSurveys(
    projectId: string,
    holeId: string,
    input: ReplaceSurveysInput,
  ): Promise<SurveyStation[]> {
    return this.#transaction(async (client) => {
      await this.#requireDrillhole(client, projectId, holeId)
      // Serialize concurrent replacements of the same hole.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [`geoeye_survey:${holeId}`])
      await client.query('DELETE FROM drillhole_surveys WHERE hole_id = $1', [holeId])
      if (input.stations.length > 0) {
        await client.query(`
          INSERT INTO drillhole_surveys (
            project_id, hole_id, measured_depth, azimuth, dip, survey_method, tool,
            accuracy, source, surveyed_at
          )
          SELECT $1, $2, station."measuredDepth", station.azimuth, station.dip,
                 station."surveyMethod", station.tool, station.accuracy, station.source,
                 station."surveyedAt"
          FROM jsonb_to_recordset($3::jsonb) AS station(
            "measuredDepth" numeric, azimuth double precision, dip double precision,
            "surveyMethod" text, tool text, accuracy double precision, source text,
            "surveyedAt" timestamptz
          )
        `, [projectId, holeId, JSON.stringify(input.stations)])
      }
      return this.#selectSurveys(client, holeId)
    })
  }

  async listProjectionBindings(projectId: string | null): Promise<ProjectionBinding[]> {
    const result = await this.#pool.query<{
      id: string
      project_id: string | null
      source_entity_type: string
      source_field: string
      variable_key: string
      extraction_json: Record<string, unknown>
      is_active: boolean
    }>(`
      SELECT binding.id, binding.project_id, binding.source_entity_type, binding.source_field,
             variable.key AS variable_key, binding.extraction_json, binding.is_active
      FROM observation_projection_bindings AS binding
      JOIN variable_definitions AS variable ON variable.id = binding.variable_id
      WHERE binding.project_id IS NULL OR binding.project_id = $1::uuid
      ORDER BY binding.source_entity_type, binding.source_field, binding.project_id NULLS FIRST
    `, [projectId])
    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      sourceEntityType: row.source_entity_type,
      sourceField: row.source_field,
      variableKey: row.variable_key,
      extraction: row.extraction_json,
      isActive: row.is_active,
    }))
  }

  async saveProjectionBindings(bindings: ProjectionBindingInput[]): Promise<ProjectionBinding[]> {
    return this.#transaction(async (client) => {
      const keys = [...new Set(bindings.map((binding) => binding.variableKey))]
      const variableResult = await client.query<{ id: string; key: string; origin: string }>(`
        SELECT id, key, origin FROM variable_definitions WHERE key = ANY($1::text[])
      `, [keys])
      const variables = new Map(variableResult.rows.map((row) => [row.key, row]))
      for (const key of keys) {
        const variable = variables.get(key)
        if (variable === undefined) throw notFound(`Variable ${key} was not found`)
        if (variable.origin !== 'primary') {
          throw conflict(`Variable ${key} is not a primary variable; Field observations are primary data`)
        }
      }
      for (const projectId of new Set(bindings.flatMap((binding) => binding.projectId ?? []))) {
        await this.#requireProject(client, projectId)
      }

      const saved: ProjectionBinding[] = []
      for (const binding of bindings) {
        const variable = variables.get(binding.variableKey)
        if (variable === undefined) throw new Error(`Variable ${binding.variableKey} disappeared`)
        const result = await client.query<{ id: string }>(`
          INSERT INTO observation_projection_bindings (
            project_id, source_entity_type, source_field, variable_id, extraction_json, is_active
          ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
          ON CONFLICT (
            COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
            source_entity_type,
            source_field
          ) DO UPDATE SET
            variable_id = EXCLUDED.variable_id,
            extraction_json = EXCLUDED.extraction_json,
            is_active = EXCLUDED.is_active
          RETURNING id
        `, [
          binding.projectId, binding.sourceEntityType, binding.sourceField, variable.id,
          JSON.stringify(binding.extraction), binding.isActive,
        ])
        const id = result.rows[0]?.id
        if (id === undefined) throw new Error('PostgreSQL did not return the saved projection binding')
        saved.push({
          id,
          projectId: binding.projectId,
          sourceEntityType: binding.sourceEntityType,
          sourceField: binding.sourceField,
          variableKey: binding.variableKey,
          extraction: binding.extraction,
          isActive: binding.isActive,
        })
      }
      return saved
    })
  }

  async listProjectionStatus(projectId: string): Promise<ProjectionStatus[]> {
    await this.#requireProject(this.#pool, projectId)
    const result = await this.#pool.query<{
      project_id: string
      source_entity_type: string
      dataset_id: string | null
      source_row_count: string
      observation_count: string
      issue_count: string
      issue_summary_json: Record<string, number>
      last_status: ProjectionStatus['lastStatus']
      last_error: string | null
      last_run_at: Date | string
      last_changed_at: Date | string | null
    }>(`
      SELECT project_id, source_entity_type, dataset_id, source_row_count::text,
             observation_count::text, issue_count::text, issue_summary_json, last_status,
             last_error, last_run_at, last_changed_at
      FROM projection_checkpoints
      WHERE project_id = $1
      ORDER BY source_entity_type
    `, [projectId])
    return result.rows.map((row) => ({
      projectId: row.project_id,
      sourceEntityType: row.source_entity_type,
      datasetId: row.dataset_id,
      sourceRowCount: Number(row.source_row_count),
      observationCount: Number(row.observation_count),
      issueCount: Number(row.issue_count),
      issueSummary: row.issue_summary_json,
      lastStatus: row.last_status,
      lastError: row.last_error,
      lastRunAt: iso(row.last_run_at),
      lastChangedAt: nullableIso(row.last_changed_at),
    }))
  }

  async runProjection(projectId: string, force: boolean): Promise<ProjectionRunResult> {
    await this.#requireProject(this.#pool, projectId)
    return runProjectProjection(this.#pool, projectId, {
      force,
      includeUnaccepted: this.#projectionIncludeUnaccepted,
    })
  }

  // Accounts, organizations and memberships are shared GeoEye data maintained by
  // Field. They are read through to_jsonb where Field revisions differ in columns.
  async findLoginAccount(email: string): Promise<LoginAccount | null> {
    const result = await this.#pool.query<{
      id: string
      password_hash: string | null
      is_active: boolean
      must_change_password: boolean
    }>(`
      SELECT profile.id, profile.password_hash,
             COALESCE((to_jsonb(profile) ->> 'is_active')::boolean, true) AS is_active,
             COALESCE((to_jsonb(profile) ->> 'must_change_password')::boolean, false)
               AS must_change_password
      FROM profiles AS profile
      WHERE lower(profile.email) = lower($1)
      ORDER BY profile.id
      LIMIT 1
    `, [email])
    const row = result.rows[0]
    if (row === undefined || row.password_hash === null) return null
    return {
      id: row.id,
      passwordHash: row.password_hash,
      isActive: row.is_active,
      mustChangePassword: row.must_change_password,
    }
  }

  async loadUserAccess(userId: string): Promise<UserAccess | null> {
    const profile = await this.#pool.query<{
      id: string
      email: string
      display_name: string | null
      role: string | null
      is_active: boolean
      is_platform_admin: boolean
    }>(`
      SELECT profile.id, profile.email, profile.display_name, profile.role,
             COALESCE((to_jsonb(profile) ->> 'is_active')::boolean, true) AS is_active,
             COALESCE((to_jsonb(profile) ->> 'is_platform_admin')::boolean, false)
               AS is_platform_admin
      FROM profiles AS profile
      WHERE profile.id = $1
    `, [userId])
    const user = profile.rows[0]
    if (user === undefined || !user.is_active) return null

    const hasOrganizations = await this.#tableExists('organizations')
      && await this.#tableExists('organization_members')
    const organizations = hasOrganizations
      ? await this.#pool.query<{ id: string; name: string; slug: string | null; role: string | null }>(`
          SELECT organization.id, organization.name, organization.slug, member.role
          FROM organization_members AS member
          JOIN organizations AS organization ON organization.id = member.organization_id
          WHERE member.user_id = $1
          ORDER BY organization.name, organization.id
        `, [userId])
      : { rows: [] }

    // A project is reachable through direct membership, or through owning or
    // administering the organization it belongs to.
    const projects = new Map<string, ProjectPermission>()
    const readOnlyAccount = user.role === 'viewer'
    if (await this.#tableExists('project_members')) {
      const direct = await this.#pool.query<{ project_id: string; role: string | null }>(`
        SELECT member.project_id, member.role
        FROM project_members AS member
        JOIN projects AS project ON project.id = member.project_id
        WHERE member.user_id = $1
          AND COALESCE((to_jsonb(project) ->> 'is_active')::boolean, true)
      `, [userId])
      for (const row of direct.rows) {
        const readOnly = readOnlyAccount || row.role === 'viewer' || row.role === 'view'
        projects.set(row.project_id, readOnly ? 'read' : 'write')
      }
    }
    if (hasOrganizations) {
      const viaOrganization = await this.#pool.query<{ project_id: string }>(`
        SELECT project.id AS project_id
        FROM projects AS project
        JOIN organization_members AS member
          ON member.organization_id::text = to_jsonb(project) ->> 'organization_id'
        WHERE member.user_id = $1 AND member.role IN ('owner', 'admin')
          AND COALESCE((to_jsonb(project) ->> 'is_active')::boolean, true)
      `, [userId])
      for (const row of viaOrganization.rows) {
        projects.set(row.project_id, readOnlyAccount ? 'read' : 'write')
      }
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name ?? user.email,
        role: user.role ?? 'geologist',
        isPlatformAdmin: user.is_platform_admin,
      },
      organizations: organizations.rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        role: row.role,
      })),
      allProjects: user.is_platform_admin,
      projects,
    }
  }

  async getAnalysisRunProjectId(runId: string): Promise<string | null> {
    const result = await this.#pool.query<{ project_id: string }>(
      'SELECT project_id FROM analysis_runs WHERE id = $1',
      [runId],
    )
    return result.rows[0]?.project_id ?? null
  }

  async close(): Promise<void> {
    await this.#pool.end()
  }

  async #tableExists(name: string): Promise<boolean> {
    const result = await this.#pool.query<{ present: boolean }>(
      "SELECT to_regclass('public.' || $1) IS NOT NULL AS present",
      [name],
    )
    return result.rows[0]?.present === true
  }

  async #tableReadable(name: string): Promise<boolean> {
    const result = await this.#pool.query<{ readable: boolean }>(`
      SELECT CASE
        WHEN to_regclass('public.' || $1) IS NULL THEN false
        ELSE has_table_privilege(current_user, 'public.' || $1, 'SELECT')
      END AS readable
    `, [name])
    return result.rows[0]?.readable === true
  }

  /**
   * The deletion ledger is optional on older Field schemas. Once present it is
   * authoritative, so a missing SELECT grant must fail closed instead of making
   * logically deleted drill holes visible again.
   */
  async #deletionLedgerPresent(): Promise<boolean> {
    if (!await this.#tableExists('depth_registration_deletions')) return false
    if (!await this.#tableReadable('depth_registration_deletions')) {
      throw new Error(
        'Database role cannot read public.depth_registration_deletions; rerun db:provision-role',
      )
    }
    return true
  }

  async #requireProject(executor: Pool | PoolClient, projectId: string): Promise<void> {
    const result = await executor.query(`
      SELECT 1
      FROM projects AS project
      WHERE project.id = $1
        AND COALESCE((to_jsonb(project) ->> 'is_active')::boolean, true)
    `, [projectId])
    if (result.rowCount === 0) throw notFound(`Project ${projectId} was not found`)
  }

  async #requireDrillhole(executor: Pool | PoolClient, projectId: string, holeId: string): Promise<void> {
    const deletions = await this.#deletionLedgerPresent()
    const currentHole = deletions
      ? `AND NOT EXISTS (
           SELECT 1 FROM depth_registration_deletions AS deletion
           WHERE deletion.entity_type = 'drill_holes' AND deletion.entity_id = drill_holes.id
         )`
      : ''
    const result = await executor.query(
      `SELECT 1 FROM drill_holes WHERE id = $1 AND project_id = $2 ${currentHole}`,
      [holeId, projectId],
    )
    if (result.rowCount === 0) {
      throw notFound(`Drillhole ${holeId} was not found in project ${projectId}`)
    }
  }

  async #selectSurveys(executor: Pool | PoolClient, holeId: string): Promise<SurveyStation[]> {
    const result = await executor.query<{
      id: string
      measured_depth: string | number
      azimuth: number
      dip: number
      survey_method: string | null
      tool: string | null
      accuracy: number | null
      source: string
      surveyed_at: Date | string | null
    }>(`
      SELECT id, measured_depth, azimuth, dip, survey_method, tool, accuracy, source, surveyed_at
      FROM drillhole_surveys
      WHERE hole_id = $1
      ORDER BY measured_depth, id
    `, [holeId])
    return result.rows.map((row) => ({
      id: row.id,
      measuredDepth: Number(row.measured_depth),
      azimuth: row.azimuth,
      dip: row.dip,
      surveyMethod: row.survey_method,
      tool: row.tool,
      accuracy: row.accuracy,
      source: row.source,
      surveyedAt: nullableIso(row.surveyed_at),
    }))
  }

  async #transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect()
    try {
      await client.query('BEGIN')
      const value = await work(client)
      await client.query('COMMIT')
      return value
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}
