import { desktopBridge, type EngineStatus } from '../desktop/bridge.js'

export interface EngineProvider { provider_id: string; display_name: string; role: string; availability: 'available' | 'missing' | 'not-configured'; detail: string; version: string | null }
export interface EngineInfo { version: string; python: string; distribution: string; multivariate: string }

export interface EngineMethods {
  'engine.info': { params: Record<string, never>; result: EngineInfo }
  'engine.providers': { params: Record<string, never>; result: EngineProvider[] }
  'distribution.summary': { params: { values: number[]; weights?: number[] }; result: Record<string, number> }
  'distribution.bootstrap': {
    params: { values: number[]; method: 'hole' | 'group' | 'spatial'; weights?: number[]; groupIds?: string[]; coordinates?: number[][]; blockSize?: number; iterations?: number; seed?: number }
    result: Record<string, unknown>
  }
  'distribution.diagnostics': { params: { values: number[]; weights?: number[] }; result: Record<string, unknown> }
  'multivariate.run': { params: Record<string, unknown>; result: Record<string, unknown> }
  'decluster.optimise': {
    params: { values: number[]; coordinates: number[][]; minimum: number; maximum: number; count?: number; anisotropy?: [number, number, number]; target?: 'minimum' | 'maximum'; offsets?: number }
    result: DeclusterResult
  }
  'variography.normalScores': { params: { values: number[]; weights?: number[] }; result: { scores: number[]; table: number[][] } }
  'variography.experimental': {
    params: { coordinates: number[][]; values: number[]; lag: number; lagCount: number; lagTolerance?: number; direction?: VariogramDirection; holeIds?: string[]; downhole?: boolean }
    result: ExperimentalVariogram
  }
  'variography.fan': { params: { coordinates: number[][]; values: number[]; plane: 'horizontal' | 'across' | 'dip'; lag: number; lagCount: number; rays?: number; tolerance?: number; planeAzimuth?: number; planeDip?: number }; result: FanResult }
  'variography.autoFit': { params: { experiments: Array<{ lags: VariogramLag[] }>; structureTypes?: StructureType[]; totalSill?: number; fixNugget?: number; maxLagFraction?: number }; result: VariogramModel }
  'variography.modelCurve': { params: { nugget: number; structures: VariogramStructure[]; h: number[]; directionIndex?: number }; result: number[] }
  'topcut.analyse': {
    params: { values: number[]; weights?: number[]; percentiles?: number[]; customCutoffs?: number[] }
    result: TopCutResult
  }
}

export interface VariogramDirection { azimuth: number; dip: number; azimuthTolerance?: number; dipTolerance?: number; bandwidth?: number }
export interface VariogramLag { distance: number; gamma: number; pairs: number }
export interface ExperimentalVariogram { lags: VariogramLag[]; variance: number; count: number }
export type StructureType = 'spherical' | 'exponential' | 'gaussian'
export interface VariogramStructure { type: StructureType; sill: number; ranges: number[] }
export interface VariogramModel { nugget: number; structures: VariogramStructure[]; totalSill: number; rmse?: number }
export interface FanResult { plane: string; rays: Array<{ angle: number; azimuth: number; dip: number; lags: VariogramLag[] }> }

export interface DeclusterPoint { cellSize: number; mean: number; cellCount: number }
export interface DeclusterResult { algorithm_version: string; curve: DeclusterPoint[]; chosen: DeclusterPoint; naiveMean: number; declusteredMean: number; weights: number[] }
export interface TopCutScenario { label: string; cutOff: number; cappedCount: number; cappedPercent: number; mean: number; meanChangePercent: number; cv: number; metalRemovedPercent: number }
export interface TopCutResult {
  algorithm_version: string; count: number; effectiveCount: number; naiveMean: number; naiveCv: number; maximum: number
  scenarios: TopCutScenario[]
  curve: Array<{ cutOff: number; mean: number; cv: number; metalRemovedPercent: number }>
  logProbability: Array<{ value: number; probability: number; z: number }>
  deciles: Record<string, number>
}

export class EngineError extends Error {
  constructor(message: string, readonly type: string | null = null) { super(message); this.name = 'EngineError' }
}

export function engineAvailable(): boolean {
  return typeof desktopBridge()?.engineCall === 'function'
}

export async function callEngine<M extends keyof EngineMethods>(method: M, params: EngineMethods[M]['params']): Promise<EngineMethods[M]['result']> {
  const bridge = desktopBridge()
  if (bridge?.engineCall === undefined) throw new EngineError('The analytics engine is only available in the desktop app', 'unavailable')
  const response = await bridge.engineCall({ method, params })
  if (!response.ok) throw new EngineError(response.error, response.type)
  return response.result as EngineMethods[M]['result']
}

export async function engineStatus(): Promise<EngineStatus> {
  const bridge = desktopBridge()
  if (bridge?.engineStatus === undefined) return { running: false, version: null, source: null, error: 'Not running in the desktop app' }
  return bridge.engineStatus()
}
