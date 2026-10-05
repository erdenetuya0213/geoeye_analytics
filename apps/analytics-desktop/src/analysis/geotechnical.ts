export type Rmr76JointCondition =
  | 'very-rough-closed'
  | 'slightly-rough-hard-wall'
  | 'slightly-rough-soft-wall'
  | 'slickensided-or-thin-gouge'
  | 'thick-soft-gouge-or-open'

export type Rmr76Groundwater = 'dry' | 'moist' | 'moderate' | 'severe'
export type Rmr76Orientation = 'very-favourable' | 'favourable' | 'fair' | 'unfavourable' | 'very-unfavourable'
export type ExcavationType = 'tunnel' | 'foundation' | 'slope'

export interface Rmr76Inputs {
  excavationType?: ExcavationType
  /** Qualitative condition, or a user-mapped RMR76 component rating from 0 to 10. */
  groundwater?: Rmr76Groundwater | number
  /** Qualitative condition, or a user-mapped RMR76 component rating from 0 to 25. */
  jointCondition?: Rmr76JointCondition | number
  jointSpacingM?: number
  /** Qualitative orientation, or an already-rated RMR76 adjustment from -60 to 0. */
  orientation?: Rmr76Orientation | number
  rqdPercent?: number
  ucsMpa?: number
}

export interface Rmr76Result {
  ratingBasis?: 'basic' | 'adjusted'
  basic: number | null
  classification: string | null
  missing: string[]
  orientationAdjustment: number | null
  scores: {
    groundwater: number | null
    jointCondition: number | null
    jointSpacing: number | null
    rqd: number | null
    strength: number | null
  }
  total: number | null
}

export interface LaubscherInputs {
  fractureFrequencyPerM?: number
  jointConditionFactorsPercent?: readonly number[]
  jointSetCount?: 1 | 2 | 3
  jointSpacingsM?: readonly number[]
  rqdPercent?: number
  ucsMpa?: number
}

export interface LaubscherResult {
  method: 'rqd-js' | 'ff' | null
  missing: string[]
  scores: {
    intactRockStrength: number | null
    jointCondition: number | null
    spacingOrFractureFrequency: number | null
    rqd: number | null
  }
  total: number | null
}

export interface MrmrFactors {
  blasting: number
  inducedStress: number
  orientation: number
  weathering: number
}

export interface QInputs {
  ja: number
  jn: number
  jr: number
  jw: number
  rqdPercent: number
  srf: number
}

export interface JointSetSpacing {
  count: number
  meanSpacingM: number | null
  setId: string
}

export const GEOTECHNICAL_REFERENCES = {
  rmr76: {
    title: 'Bieniawski (1976), Rock mass classifications in rock engineering',
    url: 'https://richardbieniawski.wordpress.com/publications/',
  },
  rmr76Table: {
    title: 'Hoek, Kaiser & Bawden, Support of Underground Excavations in Hard Rock, pp. 103–104',
    url: 'https://www.rocscience.com/assets/resources/learning/hoek/Support-of-Underground-Excavations-in-Hard-Rock.pdf',
  },
  rmr90: {
    title: 'Laubscher (1990), A geomechanics classification system for the rating of rock mass in mine design',
    url: 'https://www.saimm.co.za/Journal/v090n10p257.pdf',
  },
  qSystem: {
    title: 'NGI Q-system handbook (2022 update)',
    url: 'https://www.ngi.no/globalassets/dokumenter/forskning-og-radgivning/handbook-the-q-system-may-2015-nettutg_update-june-2022.pdf',
  },
  qOriginal: {
    title: 'Barton, Lien & Lunde (1974), Engineering classification of rock masses for tunnel support',
    url: 'https://link.springer.com/article/10.1007/BF01239496',
  },
  rqdEstimate: {
    title: 'Priest & Hudson (1976), Discontinuity spacings in rock',
    url: 'https://doi.org/10.1016/0148-9062(76)90818-4',
  },
} as const

const rmr76ConditionScores: Record<Rmr76JointCondition, number> = {
  'very-rough-closed': 25,
  'slightly-rough-hard-wall': 20,
  'slightly-rough-soft-wall': 12,
  'slickensided-or-thin-gouge': 6,
  'thick-soft-gouge-or-open': 0,
}

const rmr76GroundwaterScores: Record<Rmr76Groundwater, number> = {
  dry: 10,
  moist: 7,
  moderate: 4,
  severe: 0,
}

const rmr76OrientationScores: Record<ExcavationType, Record<Rmr76Orientation, number>> = {
  tunnel: {
    'very-favourable': 0,
    favourable: -2,
    fair: -5,
    unfavourable: -10,
    'very-unfavourable': -12,
  },
  foundation: {
    'very-favourable': 0,
    favourable: -2,
    fair: -7,
    unfavourable: -15,
    'very-unfavourable': -25,
  },
  slope: {
    'very-favourable': 0,
    favourable: -5,
    fair: -25,
    unfavourable: -50,
    'very-unfavourable': -60,
  },
}

const laubscherFrequencyTable = [
  { frequency: 0.1, scores: [40, 40, 40] },
  { frequency: 0.15, scores: [40, 40, 40] },
  { frequency: 0.2, scores: [40, 40, 38] },
  { frequency: 0.25, scores: [40, 38, 36] },
  { frequency: 0.3, scores: [38, 36, 34] },
  { frequency: 0.5, scores: [36, 34, 31] },
  { frequency: 0.8, scores: [34, 31, 28] },
  { frequency: 1, scores: [31, 28, 26] },
  { frequency: 1.5, scores: [29, 26, 24] },
  { frequency: 2, scores: [26, 24, 21] },
  { frequency: 3, scores: [24, 21, 18] },
  { frequency: 5, scores: [21, 18, 15] },
  { frequency: 7, scores: [18, 15, 12] },
  { frequency: 10, scores: [15, 12, 10] },
  { frequency: 15, scores: [12, 10, 7] },
  { frequency: 20, scores: [10, 7, 5] },
  { frequency: 30, scores: [7, 5, 2] },
  { frequency: 40, scores: [5, 2, 0] },
] as const

function isFiniteInRange(value: number | undefined, min: number, max: number) {
  return value !== undefined && Number.isFinite(value) && value >= min && value <= max
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function directRating(value: number, min: number, max: number, label: string) {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${label} rating must be between ${min} and ${max}.`)
  return value
}

export function estimateRqdFromFractureFrequency(fracturesPerM: number) {
  if (!Number.isFinite(fracturesPerM) || fracturesPerM < 0) throw new RangeError('Fracture frequency must be a finite value at or above zero.')
  return clamp(100 * Math.exp(-0.1 * fracturesPerM) * (0.1 * fracturesPerM + 1), 0, 100)
}

export function scoreRmr76Strength(ucsMpa: number) {
  if (!Number.isFinite(ucsMpa) || ucsMpa < 0) throw new RangeError('UCS must be a finite value at or above zero.')
  if (ucsMpa > 200) return 15
  if (ucsMpa >= 100) return 12
  if (ucsMpa >= 50) return 7
  if (ucsMpa >= 25) return 4
  if (ucsMpa >= 10) return 2
  if (ucsMpa >= 3) return 1
  return 0
}

export function scoreRmr76Rqd(rqdPercent: number) {
  if (!isFiniteInRange(rqdPercent, 0, 100)) throw new RangeError('RQD must be between 0 and 100 percent.')
  if (rqdPercent >= 90) return 20
  if (rqdPercent >= 75) return 17
  if (rqdPercent >= 50) return 13
  if (rqdPercent >= 25) return 8
  return 3
}

export function scoreRmr76Spacing(jointSpacingM: number) {
  if (!Number.isFinite(jointSpacingM) || jointSpacingM < 0) throw new RangeError('Joint spacing must be a finite value at or above zero.')
  if (jointSpacingM > 3) return 30
  if (jointSpacingM >= 1) return 25
  if (jointSpacingM >= 0.3) return 20
  if (jointSpacingM >= 0.05) return 10
  return 5
}

export function classifyRmr76(total: number) {
  if (total >= 81) return 'Class I · very good'
  if (total >= 61) return 'Class II · good'
  if (total >= 41) return 'Class III · fair'
  if (total >= 21) return 'Class IV · poor'
  return 'Class V · very poor'
}

export function calculateRmr76(inputs: Rmr76Inputs): Rmr76Result {
  const strength = inputs.ucsMpa === undefined ? null : scoreRmr76Strength(inputs.ucsMpa)
  const rqd = inputs.rqdPercent === undefined ? null : scoreRmr76Rqd(inputs.rqdPercent)
  const jointSpacing = inputs.jointSpacingM === undefined ? null : scoreRmr76Spacing(inputs.jointSpacingM)
  const jointCondition = inputs.jointCondition === undefined
    ? null
    : typeof inputs.jointCondition === 'number'
      ? directRating(inputs.jointCondition, 0, 25, 'Joint condition')
      : rmr76ConditionScores[inputs.jointCondition]
  const groundwater = inputs.groundwater === undefined
    ? null
    : typeof inputs.groundwater === 'number'
      ? directRating(inputs.groundwater, 0, 10, 'Groundwater')
      : rmr76GroundwaterScores[inputs.groundwater]
  const excavationType = inputs.excavationType
  const orientationAdjustment = inputs.orientation === undefined
    ? null
    : typeof inputs.orientation === 'number'
      ? directRating(inputs.orientation, -60, 0, 'Orientation adjustment')
      : excavationType === undefined
        ? null
        : rmr76OrientationScores[excavationType][inputs.orientation]
  const components = { strength, rqd, jointSpacing, jointCondition, groundwater }
  const missing = Object.entries(components).flatMap(([key, value]) => value === null ? [key] : [])
  const basic = missing.length === 0 ? Object.values(components).reduce<number>((sum, value) => sum + (value ?? 0), 0) : null
  const total = basic === null || orientationAdjustment === null ? null : clamp(basic + orientationAdjustment, 0, 100)
  if (orientationAdjustment === null) missing.push('orientationAdjustment')
  return {
    basic,
    classification: total === null ? null : classifyRmr76(total),
    missing,
    orientationAdjustment,
    scores: { groundwater, jointCondition, jointSpacing, rqd, strength },
    total,
  }
}

export function scoreLaubscherIrs(ucsMpa: number) {
  if (!Number.isFinite(ucsMpa) || ucsMpa < 0) throw new RangeError('IRS must be a finite value at or above zero.')
  if (ucsMpa > 185) return 20
  if (ucsMpa >= 165) return 18
  if (ucsMpa >= 145) return 16
  if (ucsMpa >= 125) return 14
  if (ucsMpa >= 105) return 12
  if (ucsMpa >= 85) return 10
  if (ucsMpa >= 65) return 8
  if (ucsMpa >= 45) return 6
  if (ucsMpa >= 35) return 5
  if (ucsMpa >= 25) return 4
  if (ucsMpa >= 12) return 3
  if (ucsMpa >= 5) return 2
  if (ucsMpa >= 1) return 1
  return 0
}

export function scoreLaubscherRqd(rqdPercent: number) {
  if (!isFiniteInRange(rqdPercent, 0, 100)) throw new RangeError('RQD must be between 0 and 100 percent.')
  if (rqdPercent >= 97) return 15
  if (rqdPercent >= 84) return 14
  if (rqdPercent >= 71) return 12
  if (rqdPercent >= 56) return 10
  if (rqdPercent >= 44) return 8
  if (rqdPercent >= 31) return 6
  if (rqdPercent >= 17) return 4
  if (rqdPercent >= 4) return 2
  return 0
}

export function scoreLaubscherJointSpacing(jointSpacingsM: readonly number[]) {
  if (jointSpacingsM.length < 1) throw new RangeError('At least one geological joint-set spacing is required.')
  const spacings = [...jointSpacingsM].sort((a, b) => a - b).slice(0, 3)
  if (spacings.some((spacing) => !Number.isFinite(spacing) || spacing <= 0)) throw new RangeError('Joint-set spacings must be finite values above zero.')
  const factors = spacings.map((spacing) => spacing * 100)
  let rating: number
  if (factors.length === 1) {
    const [x = 0] = factors
    rating = 25 * clamp((26.4 * Math.log10(x) + 45) / 100, 0, 1)
  } else if (factors.length === 2) {
    const [xMin = 0, xMax = 0] = factors
    rating = 25
      * clamp((25.9 * Math.log10(xMin) + 38) / 100, 0, 1)
      * clamp((30 * Math.log10(xMax) + 28) / 100, 0, 1)
  } else {
    const [xMin = 0, xMid = 0, xMax = 0] = factors
    rating = 25
      * clamp((25.9 * Math.log10(xMin) + 30) / 100, 0, 1)
      * clamp((29.6 * Math.log10(xMid) + 20) / 100, 0, 1)
      * clamp((33.3 * Math.log10(xMax) + 10) / 100, 0, 1)
  }
  return Math.round(clamp(rating, 0, 25))
}

export function scoreLaubscherFractureFrequency(fractureFrequencyPerM: number, jointSetCount: 1 | 2 | 3) {
  if (!Number.isFinite(fractureFrequencyPerM) || fractureFrequencyPerM < 0) throw new RangeError('Fracture frequency must be a finite value at or above zero.')
  const row = laubscherFrequencyTable.find((item) => fractureFrequencyPerM <= item.frequency) ?? laubscherFrequencyTable.at(-1)
  return row?.scores[jointSetCount - 1] ?? 0
}

export function scoreLaubscherJointCondition(factorsPercent: readonly number[]) {
  if (factorsPercent.length < 2) throw new RangeError('Laubscher joint condition requires macro and micro expression factors.')
  if (factorsPercent.some((factor) => !isFiniteInRange(factor, 0, 100))) throw new RangeError('Joint-condition factors must be percentages between 0 and 100.')
  const proportion = factorsPercent.reduce((product, factor) => product * factor / 100, 1)
  return Math.round(40 * proportion)
}

export function calculateLaubscherRmr(inputs: LaubscherInputs): LaubscherResult {
  if (inputs.jointSpacingsM !== undefined && inputs.fractureFrequencyPerM !== undefined) {
    throw new Error('Choose either the RQD + joint-spacing path or the fracture-frequency path, not both.')
  }
  const intactRockStrength = inputs.ucsMpa === undefined ? null : scoreLaubscherIrs(inputs.ucsMpa)
  const jointCondition = inputs.jointConditionFactorsPercent === undefined ? null : scoreLaubscherJointCondition(inputs.jointConditionFactorsPercent)
  let method: LaubscherResult['method'] = null
  let rqd: number | null = null
  let spacingOrFractureFrequency: number | null = null
  if (inputs.jointSpacingsM !== undefined) {
    method = 'rqd-js'
    rqd = inputs.rqdPercent === undefined ? null : scoreLaubscherRqd(inputs.rqdPercent)
    spacingOrFractureFrequency = scoreLaubscherJointSpacing(inputs.jointSpacingsM)
  } else if (inputs.fractureFrequencyPerM !== undefined && inputs.jointSetCount !== undefined) {
    method = 'ff'
    spacingOrFractureFrequency = scoreLaubscherFractureFrequency(inputs.fractureFrequencyPerM, inputs.jointSetCount)
  }
  const scores = { intactRockStrength, jointCondition, spacingOrFractureFrequency, rqd }
  const missing = [
    ...(intactRockStrength === null ? ['intactRockStrength'] : []),
    ...(jointCondition === null ? ['jointCondition'] : []),
    ...(method === null ? ['spacingMethod'] : []),
    ...(spacingOrFractureFrequency === null ? ['spacingOrFractureFrequency'] : []),
    ...(method === 'rqd-js' && rqd === null ? ['rqd'] : []),
  ]
  const total = missing.length === 0
    ? intactRockStrength! + jointCondition! + spacingOrFractureFrequency! + (rqd ?? 0)
    : null
  return { method, missing, scores, total }
}

export function calculateMrmr(rmr: number, factors: MrmrFactors) {
  if (!isFiniteInRange(rmr, 0, 100)) throw new RangeError('Laubscher RMR must be between 0 and 100.')
  const values = Object.values(factors)
  if (values.some((factor) => !Number.isFinite(factor) || factor < 0)) throw new RangeError('MRMR factors must be finite non-negative fractions.')
  return Math.round(rmr * values.reduce((product, factor) => product * factor, 1))
}

export function calculateQ(inputs: QInputs) {
  const values = Object.values(inputs)
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) throw new RangeError('Q-system inputs must be finite values above zero.')
  if (inputs.rqdPercent > 100) throw new RangeError('RQD must not exceed 100 percent.')
  const qRqd = Math.max(10, inputs.rqdPercent)
  return (qRqd / inputs.jn) * (inputs.jr / inputs.ja) * (inputs.jw / inputs.srf)
}

export function summarizeJointSetSpacing(points: readonly { depth: number; setId: string }[]): JointSetSpacing[] {
  const depthsBySet = new Map<string, Set<number>>()
  points.forEach((point) => {
    const depths = depthsBySet.get(point.setId) ?? new Set<number>()
    depths.add(point.depth)
    depthsBySet.set(point.setId, depths)
  })
  return [...depthsBySet.entries()].map(([setId, depthSet]) => {
    const depths = [...depthSet].sort((a, b) => a - b)
    const spacings = depths.slice(1).map((depth, index) => depth - (depths[index] ?? depth)).filter((spacing) => spacing > 0)
    return {
      count: depths.length,
      meanSpacingM: spacings.length === 0 ? null : spacings.reduce((sum, spacing) => sum + spacing, 0) / spacings.length,
      setId,
    }
  }).sort((a, b) => a.setId.localeCompare(b.setId))
}
