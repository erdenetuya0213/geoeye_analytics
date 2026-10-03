import type {
  AnalysisRun,
  AnalysisResultPackageQuery,
  AnalysisResultPackageRecord,
  SaveAnalysisResultPackageInput,
  SavedAnalysisResultPackage,
  Collar,
  CollarInput,
  Dataset,
  DerivedValueInput,
  DrillholeSummary,
  FieldLoggingOverview,
  ObservationQuery,
  ObservationValue,
  ProjectSummary,
  ProjectionBinding,
  ProjectionBindingInput,
  ProjectionRunResult,
  ProjectionStatus,
  ReplaceSurveysInput,
  SurveyStation,
  VariableDefinition,
} from '@geoeye/types'
import type { LoginAccount, UserAccess } from './auth.js'
import type { CreateAnalysisRunInput } from './schemas.js'

export interface DataPoolStore {
  /** Account lookup for sign-in. Email comparison is case-insensitive. */
  findLoginAccount(email: string): Promise<LoginAccount | null>
  /** Organizations and projects the user may reach; null when unknown or deactivated. */
  loadUserAccess(userId: string): Promise<UserAccess | null>
  /** Owning project of an analysis run, for authorization. */
  getAnalysisRunProjectId(runId: string): Promise<string | null>
  listVariables(): Promise<VariableDefinition[]>
  listProjects(): Promise<ProjectSummary[]>
  listDrillholes(projectId: string): Promise<DrillholeSummary[]>
  listFieldLogging(projectId: string): Promise<FieldLoggingOverview>
  saveCollar(projectId: string, holeId: string, input: CollarInput): Promise<Collar>
  listSurveys(projectId: string, holeId: string): Promise<SurveyStation[]>
  replaceSurveys(projectId: string, holeId: string, input: ReplaceSurveysInput): Promise<SurveyStation[]>
  listProjectionBindings(projectId: string | null): Promise<ProjectionBinding[]>
  saveProjectionBindings(bindings: ProjectionBindingInput[]): Promise<ProjectionBinding[]>
  listProjectionStatus(projectId: string): Promise<ProjectionStatus[]>
  runProjection(projectId: string, force: boolean): Promise<ProjectionRunResult>
  listDatasets(projectId: string): Promise<Dataset[]>
  queryObservations(query: ObservationQuery): Promise<ObservationValue[]>
  createAnalysisRun(input: CreateAnalysisRunInput, createdBy: string | null): Promise<AnalysisRun>
  saveDerivedValues(runId: string, values: DerivedValueInput[]): Promise<string[]>
  listAnalysisResultPackages(query: AnalysisResultPackageQuery): Promise<AnalysisResultPackageRecord[]>
  saveAnalysisResultPackage(input: SaveAnalysisResultPackageInput, createdBy: string | null): Promise<SavedAnalysisResultPackage>
  acceptAnalysisRun(runId: string, acceptedBy: string | null): Promise<AnalysisRun>
  close(): Promise<void>
}
