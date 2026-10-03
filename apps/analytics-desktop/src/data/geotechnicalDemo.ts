import type {
  GeotechnicalInterval,
  InputAvailability,
  InputCandidate,
  Rmr76CanonicalInputKey,
} from '../analysis/geotechnicalWorkflow.js'
import { estimateRqdFromFractureFrequency } from '../analysis/geotechnical.js'

export interface GeotechnicalSource {
  id: string
  label: string
  role: 'structure' | 'rqd' | 'geotechnical' | 'laboratory'
  version: string
}

export interface RmrDataset {
  id: string
  intervals: readonly GeotechnicalInterval[]
  label: string
  snapshotId: string
  snapshotLabel: string
  sources: readonly GeotechnicalSource[]
  targetTemplateId: string
  version: number
}

export const GEOTECHNICAL_SOURCE_IDS = {
  geotechnical: 'template.geotechnical-log.v34',
  rqdAuto: 'dataset.rqd-auto.v12',
  structure: 'analysis.structure.accepted.v96',
  ucsLab: 'dataset.ucs-lab.v8',
} as const

export const geotechnicalSources: readonly GeotechnicalSource[] = [
  { id: GEOTECHNICAL_SOURCE_IDS.structure, label: 'Structure auto', role: 'structure', version: 'v96' },
  { id: GEOTECHNICAL_SOURCE_IDS.rqdAuto, label: 'RQD auto', role: 'rqd', version: 'v12' },
  { id: GEOTECHNICAL_SOURCE_IDS.geotechnical, label: 'Geotech', role: 'geotechnical', version: 'v34' },
  { id: GEOTECHNICAL_SOURCE_IDS.ucsLab, label: 'UCS Lab', role: 'laboratory', version: 'v8' },
]

function candidate(
  canonicalKey: Rmr76CanonicalInputKey,
  value: unknown,
  sourceTemplateId: string,
  sourceFieldId: string,
  observationId: string,
  availability: InputAvailability,
): InputCandidate {
  if (availability === 'missing') throw new Error('Missing inputs are represented by the absence of a candidate.')
  const source = geotechnicalSources.find((item) => item.id === sourceTemplateId)
  return {
    availability,
    canonicalKey,
    observationId,
    sourceFieldId,
    sourceLabel: source?.label ?? sourceTemplateId,
    sourceTemplateId,
    value,
  }
}

interface IntervalFixture {
  depthFrom: number
  depthTo: number
  exclusionReason?: string
  exclusionSource?: string
  fractureFrequencyPerM: number
  groundwater: 'dry' | 'moist' | 'moderate' | 'severe'
  holeId: string
  jointCondition: 'very-rough-closed' | 'slightly-rough-hard-wall' | 'slightly-rough-soft-wall' | 'slickensided-or-thin-gouge' | 'thick-soft-gouge-or-open'
  jointSet: 'J1' | 'J2' | 'J3'
  jointSpacingM: number
  lithology: string
  measuredRqd?: number
  orientation: 'very-favourable' | 'favourable' | 'fair' | 'unfavourable' | 'very-unfavourable'
  structureAccepted?: boolean
  ucsMpa?: number
}

function makeInterval(fixture: IntervalFixture): GeotechnicalInterval {
  const id = `${fixture.holeId}-${fixture.depthFrom.toFixed(1)}-${fixture.depthTo.toFixed(1)}`
  const geotechObservationId = `obs-geotech-${id}`
  const candidates: InputCandidate[] = [
    candidate('geotech.rqd', estimateRqdFromFractureFrequency(fixture.fractureFrequencyPerM), GEOTECHNICAL_SOURCE_IDS.rqdAuto, 'rqd_estimated', `obs-rqd-${id}`, 'derived'),
    candidate('geotech.joint_condition', fixture.jointCondition, GEOTECHNICAL_SOURCE_IDS.geotechnical, 'joint_condition', geotechObservationId, 'direct'),
    candidate('geotech.groundwater', fixture.groundwater, GEOTECHNICAL_SOURCE_IDS.geotechnical, 'groundwater_condition', geotechObservationId, 'direct'),
  ]
  if (fixture.measuredRqd !== undefined) {
    candidates.push(candidate('geotech.rqd', fixture.measuredRqd, GEOTECHNICAL_SOURCE_IDS.geotechnical, 'rqd_percent', geotechObservationId, 'direct'))
  }
  candidates.push(candidate('geotech.ucs', 35, GEOTECHNICAL_SOURCE_IDS.geotechnical, 'field_strength_r3', geotechObservationId, 'fallback'))
  if (fixture.ucsMpa !== undefined) {
    candidates.push(candidate('geotech.ucs', fixture.ucsMpa, GEOTECHNICAL_SOURCE_IDS.ucsLab, 'ucs_mpa', `obs-ucs-${id}`, 'direct'))
  }
  if (fixture.structureAccepted !== false) {
    const structureObservationId = `accepted-structure-${fixture.jointSet}-${id}`
    candidates.push(
      candidate('structure.joint_spacing', fixture.jointSpacingM, GEOTECHNICAL_SOURCE_IDS.structure, 'accepted_joint_set_spacing_m', structureObservationId, 'derived'),
      candidate('structure.orientation_rating', { excavationType: 'tunnel', orientation: fixture.orientation }, GEOTECHNICAL_SOURCE_IDS.structure, 'accepted_joint_set_orientation_rating', structureObservationId, 'derived'),
    )
  }
  return {
    candidates,
    depthFrom: fixture.depthFrom,
    depthTo: fixture.depthTo,
    ...(fixture.exclusionReason === undefined ? {} : { exclusionReason: fixture.exclusionReason }),
    ...(fixture.exclusionSource === undefined ? {} : { exclusionSource: fixture.exclusionSource }),
    holeId: fixture.holeId,
    id,
    lithology: fixture.lithology,
  }
}

const intervals: readonly GeotechnicalInterval[] = [
  makeInterval({ depthFrom: 28, depthTo: 36, fractureFrequencyPerM: 2.8, groundwater: 'dry', holeId: 'TT_2026_002GT', jointCondition: 'slightly-rough-hard-wall', jointSet: 'J1', jointSpacingM: 1.2, lithology: 'Granodiorite', measuredRqd: 93, orientation: 'favourable', ucsMpa: 118 }),
  makeInterval({ depthFrom: 36, depthTo: 44, fractureFrequencyPerM: 5.4, groundwater: 'moist', holeId: 'TT_2026_002GT', jointCondition: 'slightly-rough-hard-wall', jointSet: 'J1', jointSpacingM: 0.62, lithology: 'Granodiorite', measuredRqd: 82, orientation: 'fair', ucsMpa: 86 }),
  makeInterval({ depthFrom: 44, depthTo: 52, fractureFrequencyPerM: 8.1, groundwater: 'moist', holeId: 'TT_2026_002GT', jointCondition: 'slightly-rough-soft-wall', jointSet: 'J2', jointSpacingM: 0.28, lithology: 'Breccia', orientation: 'fair', ucsMpa: 49 }),
  makeInterval({ depthFrom: 52, depthTo: 60, fractureFrequencyPerM: 11.3, groundwater: 'moderate', holeId: 'TT_2026_002GT', jointCondition: 'slightly-rough-soft-wall', jointSet: 'J2', jointSpacingM: 0.14, lithology: 'Breccia', measuredRqd: 61, orientation: 'unfavourable' }),
  makeInterval({ depthFrom: 60, depthTo: 68, fractureFrequencyPerM: 13.8, groundwater: 'moderate', holeId: 'TT_2026_002GT', jointCondition: 'slickensided-or-thin-gouge', jointSet: 'J3', jointSpacingM: 0.08, lithology: 'Fault zone', orientation: 'unfavourable', ucsMpa: 22 }),
  makeInterval({ depthFrom: 68, depthTo: 76, fractureFrequencyPerM: 9.5, groundwater: 'severe', holeId: 'TT_2026_002GT', jointCondition: 'thick-soft-gouge-or-open', jointSet: 'J3', jointSpacingM: 0.04, lithology: 'Fault zone', measuredRqd: 39, orientation: 'very-unfavourable', structureAccepted: false, ucsMpa: 14 }),
  makeInterval({ depthFrom: 76, depthTo: 84, exclusionReason: 'Non-RMR ground', exclusionSource: 'Geotech log', fractureFrequencyPerM: 16, groundwater: 'severe', holeId: 'TT_2026_002GT', jointCondition: 'thick-soft-gouge-or-open', jointSet: 'J3', jointSpacingM: 0.03, lithology: 'Fault zone', orientation: 'very-unfavourable', ucsMpa: 8 }),
  makeInterval({ depthFrom: 18, depthTo: 26, fractureFrequencyPerM: 4.1, groundwater: 'dry', holeId: 'TT_2026_003GT', jointCondition: 'very-rough-closed', jointSet: 'J1', jointSpacingM: 1.6, lithology: 'Andesite', measuredRqd: 89, orientation: 'very-favourable', ucsMpa: 142 }),
  makeInterval({ depthFrom: 26, depthTo: 34, fractureFrequencyPerM: 6.8, groundwater: 'moist', holeId: 'TT_2026_003GT', jointCondition: 'slightly-rough-hard-wall', jointSet: 'J2', jointSpacingM: 0.46, lithology: 'Andesite', measuredRqd: 77, orientation: 'favourable', ucsMpa: 74 }),
]

export const rmrDatasets: readonly RmrDataset[] = [
  {
    id: 'rmr76-source-join-v43',
    intervals,
    label: 'Geotechnical logging · v34',
    snapshotId: '43',
    snapshotLabel: 'Latest compatible #43',
    sources: geotechnicalSources,
    targetTemplateId: GEOTECHNICAL_SOURCE_IDS.geotechnical,
    version: 43,
  },
  {
    id: 'rmr76-source-join-v42',
    intervals: intervals.slice(0, 8),
    label: 'Geotechnical logging · v33',
    snapshotId: '42',
    snapshotLabel: 'Compatible #42',
    sources: geotechnicalSources,
    targetTemplateId: GEOTECHNICAL_SOURCE_IDS.geotechnical,
    version: 42,
  },
]

export const latestRmrDataset: RmrDataset = {
  ...rmrDatasets[0]!,
  id: 'rmr76-source-join-v44',
  snapshotId: '44',
  snapshotLabel: 'Latest compatible #44',
  version: 44,
}

export function formatInterval(depthFrom: number, depthTo: number) {
  return `${depthFrom.toFixed(1)}–${depthTo.toFixed(1)} m`
}
