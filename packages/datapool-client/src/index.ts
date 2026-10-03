import {
  analysisRunSchema,
  analysisResultPackageQuerySchema,
  analysisResultPackageRecordSchema,
  collarInputSchema,
  collarSchema,
  datasetSchema,
  drillholeSummarySchema,
  fieldLoggingOverviewSchema,
  loginInputSchema,
  loginResultSchema,
  observationQuerySchema,
  observationValueSchema,
  projectSummarySchema,
  projectionBindingSchema,
  projectionRunResultSchema,
  projectionStatusSchema,
  replaceSurveysInputSchema,
  savedAnalysisResultPackageSchema,
  sessionSchema,
  saveAnalysisResultPackageInputSchema,
  saveProjectionBindingsInputSchema,
  surveyStationSchema,
  variableDefinitionSchema,
  type AnalysisRun,
  type AnalysisResultPackageQuery,
  type AnalysisResultPackageRecord,
  type Collar,
  type DerivedValueInput,
  type DrillholeSummary,
  type FieldLoggingOverview,
  type FieldLoggingSubmission,
  type LoginResult,
  type ProjectSummary,
  type ProjectionBinding,
  type ProjectionRunResult,
  type ProjectionStatus,
  type SaveAnalysisResultPackageInput,
  type SavedAnalysisResultPackage,
  type Session,
  type SurveyStation,
} from '@geoeye/types'
import { z } from 'zod'

export type {
  Collar,
  Dataset,
  DrillholeSummary,
  FieldLoggingOverview,
  FieldLoggingSubmission,
  LoginResult,
  OrganizationSummary,
  Session,
  SessionUser,
  ObservationValue,
  ProjectSummary,
  ProjectionBinding,
  ProjectionRunResult,
  ProjectionStatus,
  SurveyStation,
  VariableDefinition,
} from '@geoeye/types'

export interface CreateAnalysisRunInput {
  projectId: string
  analysisType: string
  algorithmVersion: string
  datasetSnapshot: Record<string, unknown>
  parameters: Record<string, unknown>
}

export interface DataPoolClientOptions {
  endpoint: string
  accessToken?: () => string | undefined | Promise<string | undefined>
  fetch?: typeof globalThis.fetch
}

export class DataPoolError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'DataPoolError'
  }
}

export class DataPoolClient {
  readonly #endpoint: string
  readonly #accessToken?: DataPoolClientOptions['accessToken']
  readonly #fetch: typeof globalThis.fetch

  constructor(options: DataPoolClientOptions) {
    this.#endpoint = options.endpoint.replace(/\/$/, '')
    this.#accessToken = options.accessToken
    // Browsers throw "Illegal invocation" when fetch is called with another receiver,
    // so the global is always invoked through a wrapper rather than stored bare.
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  }

  async variables() {
    return variableDefinitionSchema.array().parse(await this.#request('/v1/variables'))
  }

  /** Signs in with a GeoEye account. The result carries the session access token. */
  async login(input: z.input<typeof loginInputSchema>): Promise<LoginResult> {
    return loginResultSchema.parse(
      await this.#request('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify(loginInputSchema.parse(input)),
      }),
    )
  }

  /** The signed-in user, or null when the credential is not a user session. */
  async session(): Promise<Session | null> {
    try {
      return sessionSchema.parse(await this.#request('/v1/auth/me'))
    } catch (error) {
      if (error instanceof DataPoolError && error.status === 404) return null
      throw error
    }
  }

  async projects(): Promise<ProjectSummary[]> {
    return projectSummarySchema.array().parse(await this.#request('/v1/projects'))
  }

  async drillholes(projectId: string): Promise<DrillholeSummary[]> {
    return drillholeSummarySchema.array().parse(
      await this.#request(`/v1/projects/${encodeURIComponent(projectId)}/drillholes`),
    )
  }

  async fieldLogging(projectId: string): Promise<FieldLoggingOverview> {
    return fieldLoggingOverviewSchema.parse(
      await this.#request(`/v1/projects/${encodeURIComponent(projectId)}/logging`),
    )
  }

  async saveCollar(
    projectId: string,
    holeId: string,
    input: z.input<typeof collarInputSchema>,
  ): Promise<Collar> {
    return collarSchema.parse(
      await this.#request(`${this.#drillholePath(projectId, holeId)}/collar`, {
        method: 'PUT',
        body: JSON.stringify(collarInputSchema.parse(input)),
      }),
    )
  }

  async surveys(projectId: string, holeId: string): Promise<SurveyStation[]> {
    return surveyStationSchema.array().parse(
      await this.#request(`${this.#drillholePath(projectId, holeId)}/surveys`),
    )
  }

  /** Replaces the whole downhole survey of one drillhole. */
  async replaceSurveys(
    projectId: string,
    holeId: string,
    input: z.input<typeof replaceSurveysInputSchema>,
  ): Promise<SurveyStation[]> {
    return surveyStationSchema.array().parse(
      await this.#request(`${this.#drillholePath(projectId, holeId)}/surveys`, {
        method: 'PUT',
        body: JSON.stringify(replaceSurveysInputSchema.parse(input)),
      }),
    )
  }

  async projectionStatus(projectId: string): Promise<ProjectionStatus[]> {
    return projectionStatusSchema.array().parse(
      await this.#request(`/v1/projects/${encodeURIComponent(projectId)}/projection`),
    )
  }

  /** Reconciles the analytical read model with what Field currently holds. */
  async runProjection(projectId: string, options: { force?: boolean } = {}): Promise<ProjectionRunResult> {
    return projectionRunResultSchema.parse(
      await this.#request(`/v1/projects/${encodeURIComponent(projectId)}/projection`, {
        method: 'POST',
        body: JSON.stringify({ force: options.force ?? false }),
      }),
    )
  }

  async projectionBindings(projectId?: string): Promise<ProjectionBinding[]> {
    const query = projectId === undefined ? '' : `?${new URLSearchParams({ projectId })}`
    return projectionBindingSchema.array().parse(await this.#request(`/v1/projection-bindings${query}`))
  }

  async saveProjectionBindings(
    input: z.input<typeof saveProjectionBindingsInputSchema>,
  ): Promise<ProjectionBinding[]> {
    return projectionBindingSchema.array().parse(
      await this.#request('/v1/projection-bindings', {
        method: 'PUT',
        body: JSON.stringify(saveProjectionBindingsInputSchema.parse(input)),
      }),
    )
  }

  async datasets(projectId: string) {
    const query = new URLSearchParams({ projectId })
    return datasetSchema.array().parse(await this.#request(`/v1/datasets?${query}`))
  }

  async queryObservations(input: z.input<typeof observationQuerySchema>) {
    const query = observationQuerySchema.parse(input)
    return observationValueSchema.array().parse(
      await this.#request('/v1/observations/query', {
        method: 'POST',
        body: JSON.stringify(query),
      }),
    )
  }

  async createAnalysisRun(input: CreateAnalysisRunInput): Promise<AnalysisRun> {
    return analysisRunSchema.parse(
      await this.#request('/v1/analysis-runs', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    )
  }

  async saveDerivedValues(runId: string, values: DerivedValueInput[]): Promise<string[]> {
    const response = await this.#request(`/v1/analysis-runs/${encodeURIComponent(runId)}/derived-values`, {
      method: 'POST',
      body: JSON.stringify({ values }),
    })
    return z.object({ ids: z.array(z.string().uuid()) }).parse(response).ids
  }

  async saveAnalysisResultPackage(
    input: SaveAnalysisResultPackageInput,
  ): Promise<SavedAnalysisResultPackage> {
    const packageInput = saveAnalysisResultPackageInputSchema.parse(input)
    return savedAnalysisResultPackageSchema.parse(
      await this.#request('/v1/analysis-result-packages', {
        method: 'POST',
        body: JSON.stringify(packageInput),
      }),
    )
  }

  async analysisResultPackages(
    input: AnalysisResultPackageQuery,
  ): Promise<AnalysisResultPackageRecord[]> {
    const query = analysisResultPackageQuerySchema.parse(input)
    const search = new URLSearchParams({ tenantKey: query.tenantKey, projectId: query.projectId })
    if (query.datasetId !== undefined) search.set('datasetId', query.datasetId)
    if (query.boreholeId !== undefined) search.set('boreholeId', query.boreholeId)
    if (query.feature !== undefined) search.set('feature', query.feature)
    return analysisResultPackageRecordSchema.array().parse(
      await this.#request(`/v1/analysis-result-packages?${search}`),
    )
  }

  async acceptAnalysisRun(runId: string): Promise<AnalysisRun> {
    return analysisRunSchema.parse(
      await this.#request(`/v1/analysis-runs/${encodeURIComponent(runId)}/accept`, {
        method: 'POST',
      }),
    )
  }

  #drillholePath(projectId: string, holeId: string): string {
    return `/v1/projects/${encodeURIComponent(projectId)}/drillholes/${encodeURIComponent(holeId)}`
  }

  async #request(path: string, init: RequestInit = {}): Promise<unknown> {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (init.body !== undefined) headers.set('Content-Type', 'application/json')

    const token = await this.#accessToken?.()
    if (token) headers.set('Authorization', `Bearer ${token}`)

    const response = await this.#fetch(`${this.#endpoint}${path}`, { ...init, headers })
    const contentType = response.headers.get('content-type') ?? ''
    const payload: unknown = contentType.includes('application/json')
      ? await response.json()
      : await response.text()

    if (!response.ok) {
      throw new DataPoolError(`Data Pool request failed with status ${response.status}`, response.status, payload)
    }

    return payload
  }
}
