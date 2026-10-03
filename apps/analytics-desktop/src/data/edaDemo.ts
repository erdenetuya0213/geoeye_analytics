import type { EdaObservation } from '../analysis/eda.js'
import { buildAnalyticalObservations } from '../analysis/analyticalDataset.js'
import {
  readGeotechnicalDerivedDocument,
  type GeotechnicalDerivedDocument,
  type StorageLike,
} from './geotechnicalDerivedStore.js'
import { readMultivariateDerivedDocument, type MultivariateDerivedDocument } from './multivariateDerivedStore.js'

export type EdaVariableKey = string

export interface EdaVariableDefinition {
  dataType?: 'numeric' | 'category'
  decimals: number
  key: EdaVariableKey
  label: string
  method?: string
  origin?: 'primary' | 'integrated' | 'derived'
  scoreType?: 'bounded_ordinal_score'
  shortLabel: string
  unit: string
}

export function mergeSavedMultivariateIntoEda(dataset: EdaDataset, document: MultivariateDerivedDocument): EdaDataset {
  const latestTemplateVersion = document.fields
    .filter((field) => field.datasetId === dataset.id)
    .reduce((latest, field) => Math.max(latest, field.templateVersion), 0)
  const fields = document.fields.filter((field) => field.datasetId === dataset.id && field.templateVersion === latestTemplateVersion)
  if (fields.length === 0) return dataset
  const rows = document.rows.filter((row) => row.datasetId === dataset.id && row.templateVersion === latestTemplateVersion)
  const byObservation = new Map(rows.map((row) => [row.observationId, row]))
  const bySource = new Map(rows.flatMap((row) => row.sourceObservationIds.map((sourceId) => [sourceId, row] as const)))
  return {
    ...dataset,
    observations: dataset.observations.map((observation) => {
      const sourceIds = observation.sourceObservationIds ?? [observation.sourceObservationId]
      const row = byObservation.get(observation.id) ?? sourceIds.map((sourceId) => bySource.get(sourceId)).find((candidate) => candidate !== undefined)
      return row === undefined ? observation : { ...observation, values: { ...observation.values, ...row.values } }
    }),
    variables: [
      ...dataset.variables.filter((variable) => !fields.some((field) => field.key === variable.key)),
      ...fields.map((field): EdaVariableDefinition => ({
        dataType: field.dataType,
        decimals: field.dataType === 'category' ? 0 : 3,
        key: field.key,
        label: field.name,
        method: `${field.method} · ${field.version} · run #${field.runNumber}`,
        origin: 'derived',
        shortLabel: field.key === 'multivariate.cluster_id' ? 'Cluster' : field.key.replace('multivariate.', '').toUpperCase(),
        unit: field.dataType === 'category' ? 'class' : 'score',
      })),
    ],
  }
}

export interface EdaDimensionDefinition {
  key: string
  label: string
}

export interface EdaDataset {
  dimensions: readonly EdaDimensionDefinition[]
  id: string
  name: string
  observations: EdaObservation[]
  producer: string
  project: string
  snapshotAt: string
  source: 'demo'
  support: string
  variables: readonly EdaVariableDefinition[]
}

export const EDA_DATASET_QUERY_KEY = ['eda-datasets', 'oyu-ridge-v4'] as const

const assayVariables: readonly EdaVariableDefinition[] = [
  { key: 'assay.au', label: 'Gold assay', origin: 'integrated', shortLabel: 'Au', unit: 'g/t', decimals: 2 },
  { key: 'assay.cu', label: 'Copper assay', origin: 'integrated', shortLabel: 'Cu', unit: '%', decimals: 3 },
  { key: 'assay.as', label: 'Arsenic assay', origin: 'integrated', shortLabel: 'As', unit: 'ppm', decimals: 0 },
]

const geotechnicalVariables: readonly EdaVariableDefinition[] = [
  { key: 'geotech.rqd', label: 'Rock Quality Designation', origin: 'primary', shortLabel: 'RQD', unit: '%', decimals: 1 },
  { key: 'geotech.ucs', label: 'Uniaxial compressive strength', origin: 'primary', shortLabel: 'UCS', unit: 'MPa', decimals: 1 },
]

export const edaVariables: readonly EdaVariableDefinition[] = [...assayVariables, ...geotechnicalVariables]

const sharedDimensions: readonly EdaDimensionDefinition[] = [
  { key: 'drillhole', label: 'Drillhole' },
  { key: 'lithology', label: 'Lithology' },
  { key: 'alteration', label: 'Alteration' },
  { key: 'domain', label: 'Domain' },
  { key: 'campaign', label: 'Campaign' },
  { key: 'validation', label: 'Validation' },
]

const holeOrigins = [
  { id: 'GOR-DD-012', easting: 498_920, northing: 4_768_040, phase: 0.3 },
  { id: 'GOR-DD-013', easting: 498_990, northing: 4_768_085, phase: 0.8 },
  { id: 'GOR-DD-014', easting: 499_065, northing: 4_768_122, phase: 1.1 },
  { id: 'GOR-DD-015', easting: 499_135, northing: 4_768_168, phase: 1.7 },
  { id: 'GOR-DD-016', easting: 499_210, northing: 4_768_210, phase: 2.2 },
  { id: 'GOR-DD-017', easting: 499_286, northing: 4_768_252, phase: 2.7 },
  { id: 'GOR-DD-018', easting: 499_360, northing: 4_768_298, phase: 3.1 },
] as const

const lithologies = ['Andesite', 'Breccia', 'Diorite', 'Volcaniclastic'] as const
const alterations = ['Propylitic', 'Phyllic', 'Silicic'] as const

function round(value: number, decimals: number) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

interface GeneratedInterval {
  assayValues: Record<string, number | null>
  base: Omit<EdaObservation, 'id' | 'sourceObservationId' | 'values'>
  geotechnicalValues: Record<string, number | null>
}

function generateIntervals(): GeneratedInterval[] {
  return holeOrigins.flatMap((hole, holeIndex) => Array.from({ length: 44 }, (_, sampleIndex) => {
    const depthFrom = 24 + sampleIndex * 4
    const depthTo = depthFrom + 4
    const depthMidpoint = (depthFrom + depthTo) / 2
    const mineralizedCentre = 105 + holeIndex * 3.5
    const mineralizedEnvelope = Math.exp(-(((depthMidpoint - mineralizedCentre) / 29) ** 2))
    const localStructure = Math.max(0, Math.sin(sampleIndex * 0.77 + hole.phase))
    const highGradePulse = (sampleIndex + holeIndex * 3) % 37 === 0 ? 5.8 : 0
    const gold = clamp(0.045 + mineralizedEnvelope * (2.2 + holeIndex * 0.16) + localStructure * 0.38 + highGradePulse, 0.01, 12)
    const copper = clamp(0.018 + gold * 0.026 + mineralizedEnvelope * 0.055 + Math.cos(sampleIndex * 0.51 + hole.phase) * 0.011, 0.003, 0.45)
    const arsenic = clamp(18 + gold * 78 + mineralizedEnvelope * 110 + Math.sin(sampleIndex * 0.29 + hole.phase) * 22, 2, 1_450)
    const rqd = clamp(77 - mineralizedEnvelope * 24 + Math.sin(sampleIndex * 0.42 + hole.phase) * 13 - localStructure * 7, 18, 98)
    const ucs = clamp(42 + rqd * 0.92 + Math.cos(sampleIndex * 0.31 + hole.phase) * 18, 28, 168)
    const lithology = lithologies[(Math.floor(sampleIndex / 11) + holeIndex) % lithologies.length] ?? lithologies[0]
    const alteration = alterations[(Math.floor(sampleIndex / 7) + holeIndex) % alterations.length] ?? alterations[0]
    const joinKey = `${hole.id}:${depthFrom.toFixed(2)}:${depthTo.toFixed(2)}`
    const dimensions = {
      campaign: holeIndex < 4 ? '2025 infill' : '2026 extension',
      domain: mineralizedEnvelope > 0.42 ? 'Mineralized envelope' : 'Background',
      drillhole: hole.id,
      lithology,
      alteration,
      validation: (sampleIndex + holeIndex) % 17 === 0 ? 'Pending QA' : 'Validated',
    }

    return {
      assayValues: {
        'assay.au': sampleIndex % 43 === 11 ? null : round(gold, 3),
        'assay.cu': sampleIndex % 41 === 7 ? null : round(copper, 4),
        'assay.as': sampleIndex % 38 === 9 ? null : round(arsenic, 0),
      },
      base: {
        depthFrom,
        depthTo,
        dimensions,
        easting: round(hole.easting + depthMidpoint * 0.22, 1),
        holeId: hole.id,
        joinKey,
        lithology,
        northing: round(hole.northing + depthMidpoint * 0.08, 1),
        sampleId: `INT-${String(holeIndex + 12).padStart(2, '0')}-${String(sampleIndex + 1).padStart(3, '0')}`,
      },
      geotechnicalValues: {
        'geotech.rqd': sampleIndex % 39 === 5 ? null : round(rqd, 1),
        'geotech.ucs': sampleIndex % 40 === 13 ? null : round(ucs, 1),
      },
    }
  }))
}

const generatedIntervals = generateIntervals()

function observationsFor(source: 'assay' | 'geotechnical'): EdaObservation[] {
  return generatedIntervals.map((interval) => ({
    ...interval.base,
    id: `${source}-${interval.base.joinKey}`,
    sampleId: source === 'assay' ? `ALS-${interval.base.sampleId}` : `GTL-${interval.base.sampleId}`,
    sourceObservationId: `observation.${source}.${interval.base.joinKey}`,
    values: source === 'assay' ? interval.assayValues : interval.geotechnicalValues,
  }))
}

export const edaDemoDataset: EdaDataset = {
  dimensions: sharedDimensions,
  id: 'demo-als-gold-assays-v4',
  name: 'Gold assays · v4',
  observations: observationsFor('assay'),
  producer: 'ALS Laboratory · demonstration fixture',
  project: 'Oyu Ridge',
  snapshotAt: '2026-09-30T08:00:00.000Z',
  source: 'demo',
  support: 'Raw assay intervals · 4.0 m nominal',
  variables: assayVariables,
}

export const edaGeotechnicalDataset: EdaDataset = {
  dimensions: sharedDimensions,
  id: 'demo-geotechnical-log-v4',
  name: 'Geotechnical log · v4',
  observations: observationsFor('geotechnical'),
  producer: 'GeoEye Logging · demonstration fixture',
  project: 'Oyu Ridge',
  snapshotAt: '2026-09-30T09:15:00.000Z',
  source: 'demo',
  support: 'Geotechnical log intervals · 4.0 m nominal',
  variables: geotechnicalVariables,
}

export const edaIntegratedDataset: EdaDataset = {
  dimensions: sharedDimensions,
  id: 'demo-integrated-gold-geology-v4',
  name: 'Gold assays + geological logging',
  observations: buildAnalyticalObservations(
    edaDemoDataset.id,
    edaDemoDataset.observations,
    [{
      datasetId: edaGeotechnicalDataset.id,
      dimensions: ['lithology', 'alteration', 'domain'],
      match: 'interval-overlap',
      observations: edaGeotechnicalDataset.observations,
    }],
  ),
  producer: 'GeoEye analytical view · source tables unchanged',
  project: 'Oyu Ridge',
  snapshotAt: edaGeotechnicalDataset.snapshotAt,
  source: 'demo',
  support: 'Assay intervals · attached logging by interval overlap',
  variables: [...assayVariables, ...geotechnicalVariables],
}

export function mergeSavedRmr76IntoEda(
  dataset: EdaDataset,
  document: GeotechnicalDerivedDocument,
): EdaDataset {
  if (!document.fields.some((field) => field.key === 'geotech.rmr76') || document.intervals.length === 0) return dataset
  const activeIntervals = document.intervals.filter((interval) => interval.scenarioId === document.activeScenarioId)
  if (activeIntervals.length === 0) return dataset
  const savedObservations: EdaObservation[] = activeIntervals.map((interval) => ({
    depthFrom: interval.depthFrom,
    depthTo: interval.depthTo,
    dimensions: {
      campaign: 'Derived run',
      domain: 'Unassigned',
      drillhole: interval.holeId,
      lithology: interval.lithology,
    },
    easting: 499_420,
    holeId: interval.holeId,
    id: `derived-rmr76-${interval.sourceEntityId}`,
    joinKey: `${interval.holeId}:${interval.depthFrom.toFixed(2)}:${interval.depthTo.toFixed(2)}`,
    lithology: interval.lithology,
    northing: 4_768_330,
    sampleId: interval.sourceEntityId,
    sourceObservationId: interval.sourceLineage[0]?.observationId ?? interval.sourceEntityId,
    values: {
      'geotech.rmr76': interval.rmr76,
      'geotech.rqd': interval.inputValues.rqdPercent,
      'geotech.ucs': interval.inputValues.ucsMpa,
    },
  }))
  const baseObservations = dataset.observations.filter((observation) => !observation.id.startsWith('derived-rmr76-'))
  const rmrVariable: EdaVariableDefinition = {
    decimals: 0,
    key: 'geotech.rmr76',
    label: 'Rock Mass Rating 1976',
    method: 'Bieniawski 1976',
    origin: 'derived',
    scoreType: 'bounded_ordinal_score',
    shortLabel: 'RMR76',
    unit: 'score',
  }
  return {
    ...dataset,
    observations: [...baseObservations, ...savedObservations],
    snapshotAt: activeIntervals.reduce((latest, interval) => interval.savedAt > latest ? interval.savedAt : latest, dataset.snapshotAt),
    variables: [...dataset.variables.filter((variable) => variable.key !== rmrVariable.key), rmrVariable],
  }
}

export async function loadEdaDatasets(storage: StorageLike | undefined = typeof window === 'undefined' ? undefined : window.localStorage): Promise<EdaDataset[]> {
  const derivedDocument = readGeotechnicalDerivedDocument(storage)
  const multivariateDocument = readMultivariateDerivedDocument(storage)
  return Promise.resolve([
    mergeSavedMultivariateIntoEda(edaDemoDataset, multivariateDocument),
    mergeSavedMultivariateIntoEda(mergeSavedRmr76IntoEda(edaGeotechnicalDataset, derivedDocument), multivariateDocument),
    mergeSavedMultivariateIntoEda(edaIntegratedDataset, multivariateDocument),
  ])
}

export async function loadEdaDataset(storage: StorageLike | undefined = typeof window === 'undefined' ? undefined : window.localStorage): Promise<EdaDataset> {
  return Promise.resolve(mergeSavedRmr76IntoEda(edaDemoDataset, readGeotechnicalDerivedDocument(storage)))
}
