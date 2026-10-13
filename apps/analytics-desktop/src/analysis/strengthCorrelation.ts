import { normalizedHoleIdentifier } from '@geoeye/datapool-client'
import type { EdaDataset } from '../data/edaTypes.js'
import { bestSupportPartner, pearsonCorrelation, spearmanCorrelation, summarizeValues, type EdaObservation, type SummaryStatistics } from './eda.js'
import { DEFAULT_POINT_LOAD_UCS_FACTOR, DEFAULT_UNIT_WEIGHT_KN_M3, pointLoadToUcsMpa, schmidtToUcsMpa } from './schmidt.js'

export interface SourceRef { datasetId: string; key: string }
export interface StrengthSources {
  schmidt?: SourceRef | undefined
  pointLoad?: SourceRef | undefined
  grade?: SourceRef | undefined
  lab?: (SourceRef & { testTypeKey?: string | undefined; testType?: string | undefined }) | undefined
}
export interface StrengthSettings { unitWeightKnM3: number; ucsFactor: number; windowM: number }
export const DEFAULT_STRENGTH_SETTINGS: StrengthSettings = { ucsFactor: DEFAULT_POINT_LOAD_UCS_FACTOR, unitWeightKnM3: DEFAULT_UNIT_WEIGHT_KN_M3, windowM: 1 }

export interface GradeRow { grade: string; n: number; min: number; q1: number; median: number; q3: number; max: number }
export interface PliSchmidtPair { hole: string; depth: number; schmidt: number; schmidtReadings: number; pointLoad: number }
export interface UcsGroup { name: 'Schmidt-derived' | 'Point-load-derived' | 'Lab UCS'; stats: SummaryStatistics }
export interface HoleRow { hole: string; schmidtReadings: number; schmidtMeanR: number | null; schmidtUcs: number | null; pliTests: number; pliUcs: number | null; labTests: number; labUcs: number | null }
export interface UnitCheck { impliedIs50: number; measuredIs50: number; ratio: number; flag: 'ok' | 'measured-low' | 'measured-high' }
export interface Finding { level: 'ok' | 'warn' | 'info'; text: string }

export interface StrengthCorrelationResult {
  grades: GradeRow[]
  gradeMonotonic: boolean | null
  pairs: PliSchmidtPair[]
  pearson: number | null
  spearman: number | null
  pointLoadCv: number | null
  unitCheck: UnitCheck | null
  ucs: UcsGroup[]
  holes: HoleRow[]
  findings: Finding[]
}

const num = (observation: EdaObservation, key: string): number | null => {
  const value = observation.values[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
const hasNumber = (key: string) => (observation: EdaObservation) => num(observation, key) !== null
const mean = (values: readonly number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
const median = (values: readonly number[]) => summarizeValues(values).median

/** ISRM grade code (R0–R6) from a category value such as "R3 Medium strong rock". */
export function isrmGrade(value: string | undefined): string | null {
  const match = value === undefined ? null : /^R([0-6])(?:\b|\s|$)/i.exec(value.trim())
  return match === null ? null : `R${match[1]}`
}

/** Schmidt readings grouped by the logged ISRM grade at the same hole and depth. */
export function schmidtByGrade(schmidt: readonly EdaObservation[], schmidtKey: string, grades: readonly EdaObservation[], gradeKey: string): GradeRow[] {
  const hasGrade = (observation: EdaObservation) => isrmGrade(observation.dimensions[gradeKey]) !== null
  const gradeRows = grades.filter(hasGrade)
  const byGrade = new Map<string, number[]>()
  for (const reading of schmidt) {
    const value = num(reading, schmidtKey)
    if (value === null) continue
    const partner = bestSupportPartner(reading, gradeRows, hasGrade)
    const grade = partner === undefined ? null : isrmGrade(partner.dimensions[gradeKey])
    if (grade !== null) (byGrade.get(grade) ?? byGrade.set(grade, []).get(grade))!.push(value)
  }
  return [...byGrade.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([grade, values]) => {
    const stats = summarizeValues(values)
    return { grade, max: stats.maximum!, median: stats.median!, min: stats.minimum!, n: stats.count, q1: stats.q1!, q3: stats.q3! }
  })
}

/** For each point-load test, the mean Schmidt R within ±windowM of its depth in the same hole. */
export function pointLoadVsSchmidt(pointLoad: readonly EdaObservation[], pointLoadKey: string, schmidt: readonly EdaObservation[], schmidtKey: string, windowM: number): PliSchmidtPair[] {
  const byHole = new Map<string, EdaObservation[]>()
  for (const reading of schmidt.filter(hasNumber(schmidtKey))) {
    const hole = normalizedHoleIdentifier(reading.holeId)
    ;(byHole.get(hole) ?? byHole.set(hole, []).get(hole))!.push(reading)
  }
  return pointLoad.flatMap((test) => {
    const value = num(test, pointLoadKey)
    if (value === null) return []
    const depth = (test.depthFrom + test.depthTo) / 2
    if (!Number.isFinite(depth)) return []
    const readings = (byHole.get(normalizedHoleIdentifier(test.holeId)) ?? [])
      .filter((reading) => reading.depthTo >= depth - windowM && reading.depthFrom <= depth + windowM)
      .map((reading) => num(reading, schmidtKey)!)
    return readings.length === 0 ? [] : [{ depth, hole: test.holeId, pointLoad: value, schmidt: mean(readings)!, schmidtReadings: readings.length }]
  })
}

/** Compares the Is(50) the Schmidt readings imply (UCS/K) with the measured Is(50). */
export function unitCheck(pairs: readonly PliSchmidtPair[], settings: StrengthSettings): UnitCheck | null {
  const implied = pairs.flatMap((pair) => { const ucs = schmidtToUcsMpa(pair.schmidt, settings.unitWeightKnM3); return ucs === null ? [] : [ucs / settings.ucsFactor] })
  const measured = pairs.map((pair) => pair.pointLoad)
  if (implied.length < 3 || measured.length < 3) return null
  const impliedIs50 = median(implied)!, measuredIs50 = median(measured)!
  if (measuredIs50 <= 0) return null
  const ratio = impliedIs50 / measuredIs50
  return { flag: ratio > 3 ? 'measured-low' : ratio < 1 / 3 ? 'measured-high' : 'ok', impliedIs50, measuredIs50, ratio }
}

export function analyzeStrength(datasets: readonly EdaDataset[], sources: StrengthSources, settings: StrengthSettings): StrengthCorrelationResult {
  const find = (ref: SourceRef | undefined) => ref === undefined ? undefined : datasets.find((dataset) => dataset.id === ref.datasetId)
  const schmidtData = find(sources.schmidt), pliData = find(sources.pointLoad), gradeData = find(sources.grade), labData = find(sources.lab)
  const schmidt = sources.schmidt && schmidtData ? schmidtData.observations.filter(hasNumber(sources.schmidt.key)) : []
  const pli = sources.pointLoad && pliData ? pliData.observations.filter(hasNumber(sources.pointLoad.key)) : []

  const grades = sources.schmidt && sources.grade && gradeData ? schmidtByGrade(schmidt, sources.schmidt.key, gradeData.observations, sources.grade.key) : []
  const medians = grades.filter((row) => row.n >= 5).map((row) => row.median)
  const gradeMonotonic = medians.length < 3 ? null : medians.every((value, index) => index === 0 || value >= medians[index - 1]!)

  const pairs = sources.schmidt && sources.pointLoad ? pointLoadVsSchmidt(pli, sources.pointLoad.key, schmidt, sources.schmidt.key, settings.windowM) : []
  const pearson = pairs.length >= 3 ? pearsonCorrelation(pairs.map((p) => p.schmidt), pairs.map((p) => p.pointLoad)) : null
  const spearman = pairs.length >= 3 ? spearmanCorrelation(pairs.map((p) => p.schmidt), pairs.map((p) => p.pointLoad)) : null
  const pliValues = pli.map((o) => num(o, sources.pointLoad!.key)!)
  const pointLoadCv = pliValues.length < 3 ? null : summarizeValues(pliValues).coefficientOfVariation
  const check = unitCheck(pairs, settings)

  const schmidtUcs = schmidt.flatMap((o) => { const v = schmidtToUcsMpa(num(o, sources.schmidt!.key)!, settings.unitWeightKnM3); return v === null ? [] : [v] })
  const pliUcs = pli.flatMap((o) => { const v = pointLoadToUcsMpa(num(o, sources.pointLoad!.key)!, settings.ucsFactor); return v === null ? [] : [v] })
  const labRows = sources.lab && labData
    ? labData.observations.filter((o) => num(o, sources.lab!.key) !== null
      && (sources.lab!.testTypeKey === undefined || sources.lab!.testType === undefined || sources.lab!.testType === '' || o.dimensions[sources.lab!.testTypeKey] === sources.lab!.testType))
    : []
  const labUcs = labRows.map((o) => num(o, sources.lab!.key)!)
  const ucs: UcsGroup[] = [
    { name: 'Schmidt-derived', stats: summarizeValues(schmidtUcs) },
    { name: 'Point-load-derived', stats: summarizeValues(pliUcs) },
    { name: 'Lab UCS', stats: summarizeValues(labUcs) },
  ]

  const holeKeys = new Set<string>()
  const label = new Map<string, string>()
  for (const o of [...schmidt, ...pli, ...labRows.filter((row) => row.holeId !== 'Project')]) {
    const key = normalizedHoleIdentifier(o.holeId)
    if (key.length > 0) { holeKeys.add(key); if (!label.has(key)) label.set(key, o.holeId) }
  }
  const holes: HoleRow[] = [...holeKeys].sort().map((key) => {
    const inHole = (o: EdaObservation) => normalizedHoleIdentifier(o.holeId) === key
    const r = schmidt.filter(inHole).map((o) => num(o, sources.schmidt!.key)!)
    const rUcs = r.flatMap((v) => { const u = schmidtToUcsMpa(v, settings.unitWeightKnM3); return u === null ? [] : [u] })
    const p = pli.filter(inHole).map((o) => num(o, sources.pointLoad!.key)!)
    const l = labRows.filter(inHole).map((o) => num(o, sources.lab!.key)!)
    return {
      hole: label.get(key)!, labTests: l.length, labUcs: mean(l), pliTests: p.length, pliUcs: mean(p.flatMap((v) => { const u = pointLoadToUcsMpa(v, settings.ucsFactor); return u === null ? [] : [u] })),
      schmidtMeanR: mean(r), schmidtReadings: r.length, schmidtUcs: mean(rUcs),
    }
  })

  return { findings: explain({ check, gradeMonotonic, grades, pairs, pearson, pliCount: pli.length, pointLoadCv, spearman, ucs }), gradeMonotonic, grades, holes, pairs, pearson, pointLoadCv, spearman, ucs, unitCheck: check }
}

function explain(input: { check: UnitCheck | null; gradeMonotonic: boolean | null; grades: GradeRow[]; pairs: PliSchmidtPair[]; pearson: number | null; pliCount: number; pointLoadCv: number | null; spearman: number | null; ucs: UcsGroup[] }): Finding[] {
  const out: Finding[] = []
  if (input.grades.length > 0) {
    const text = input.grades.map((row) => `${row.grade} ${row.median.toFixed(0)}`).join(' → ')
    out.push(input.gradeMonotonic === false
      ? { level: 'warn', text: `Median Schmidt R does not rise with the logged ISRM grade (${text}). Check the logging or the hammer readings.` }
      : { level: 'ok', text: `Median Schmidt R follows the logged ISRM grade: ${text}.` })
  }
  if (input.check !== null) {
    const { ratio, impliedIs50, measuredIs50, flag } = input.check
    out.push(flag === 'ok'
      ? { level: 'ok', text: `Point-load Is(50) (median ${measuredIs50.toFixed(2)} MPa) is consistent with what Schmidt implies (${impliedIs50.toFixed(2)} MPa).` }
      : { level: 'warn', text: `Measured Is(50) median ${measuredIs50.toFixed(2)} MPa is ${flag === 'measured-low' ? `${ratio.toFixed(0)}× lower` : `${(1 / ratio).toFixed(0)}× higher`} than the ${impliedIs50.toFixed(2)} MPa Schmidt implies. Check the point-load sheet units (kN, gauge reading, tonnes-force) before using it for UCS.` })
  }
  if (input.pairs.length >= 3 && input.spearman !== null) {
    const weak = Math.abs(input.spearman) < 0.5
    out.push({ level: weak ? 'warn' : 'ok', text: `Point load vs Schmidt at the same depth: Spearman ${input.spearman.toFixed(2)}${input.pearson === null ? '' : `, Pearson ${input.pearson.toFixed(2)}`} (n = ${input.pairs.length})${weak && input.pointLoadCv !== null && input.pointLoadCv < 0.15 ? `. Point-load values barely vary (CV ${(input.pointLoadCv * 100).toFixed(0)} %), so there is little to correlate.` : weak ? '. Weak link.' : '.'}` })
  }
  if (input.pairs.length >= 3 && input.spearman === null) {
    out.push({ level: 'warn', text: `Point load vs Schmidt: the ${input.pairs.length} matched pairs have identical values on one axis, so no correlation can be computed.` })
  }
  const [schmidt, , lab] = input.ucs
  if (schmidt?.stats.median != null && lab?.stats.median != null) {
    const ratio = schmidt.stats.median / lab.stats.median
    out.push({ level: ratio < 0.5 || ratio > 2 ? 'warn' : 'info', text: `Schmidt-derived UCS median ${schmidt.stats.median.toFixed(0)} MPa vs lab ${lab.stats.median.toFixed(0)} MPa (ratio ${ratio.toFixed(2)}). Lab tests without depth can only be compared overall, not hole by hole.` })
  }
  return out
}

export interface StrengthSourceGuess extends StrengthSources {}

/** Picks sensible sources by variable/dimension names so the template opens with something useful. */
export function guessStrengthSources(datasets: readonly EdaDataset[]): StrengthSourceGuess {
  const best = (pick: (dataset: EdaDataset) => string | undefined, count: (dataset: EdaDataset, key: string) => number): SourceRef | undefined => {
    let winner: { ref: SourceRef; n: number } | undefined
    for (const dataset of datasets) {
      const key = pick(dataset)
      if (key === undefined) continue
      const n = count(dataset, key)
      if (n > 0 && (winner === undefined || n > winner.n)) winner = { n, ref: { datasetId: dataset.id, key } }
    }
    return winner?.ref
  }
  const numericVar = (re: RegExp) => (dataset: EdaDataset) => dataset.variables.find((v) => v.dataType !== 'category' && re.test(`${v.key} ${v.label}`))?.key
  const filled = (dataset: EdaDataset, key: string) => dataset.observations.filter((o) => num(o, key) !== null).length
  const schmidt = best(numericVar(/schmidt|smidth|rebound/i), filled)
  const pointLoad = best(numericVar(/\bis\s*\(?50\)?|is50/i), filled) ?? best(numericVar(/point[ -]?load|peak load/i), filled)
  const grade = best((dataset) => dataset.dimensions.find((d) => /field[ _-]?strength|isrm/i.test(`${d.key} ${d.label}`))?.key,
    (dataset, key) => dataset.observations.filter((o) => isrmGrade(o.dimensions[key]) !== null).length)
  const lab = best((dataset) => /laborator|\blab\b/i.test(dataset.name) ? dataset.variables.find((v) => v.dataType !== 'category' && /^(strength|ucs)|uniaxial/i.test(`${v.key} ${v.label}`))?.key : undefined, filled)
  const labDataset = lab === undefined ? undefined : datasets.find((d) => d.id === lab.datasetId)
  const testTypeKey = labDataset?.dimensions.find((d) => /test[ _-]?type/i.test(`${d.key} ${d.label}`))?.key
  const hasUcs = testTypeKey !== undefined && labDataset!.observations.some((o) => o.dimensions[testTypeKey] === 'UCS')
  return {
    grade, pointLoad, schmidt,
    lab: lab === undefined ? undefined : { ...lab, testType: hasUcs ? 'UCS' : undefined, testTypeKey },
  }
}
