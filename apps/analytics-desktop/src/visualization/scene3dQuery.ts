import type { EdaObservation } from '../analysis/eda.js'
import type { EdaDataset } from '../data/edaDemo.js'

export type SceneQueryValue = number | string | null

export interface CompiledSceneQuery {
  error: string | null
  matches: (observation: EdaObservation) => boolean
}

function normalizedField(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function observationField(dataset: EdaDataset, observation: EdaObservation, requestedField: string): SceneQueryValue | undefined {
  const field = normalizedField(requestedField)
  const builtInFields: Record<string, SceneQueryValue> = {
    alteration: observation.dimensions.alteration ?? null,
    domain: observation.dimensions.domain ?? null,
    domainid: observation.dimensions.domain ?? null,
    drillhole: observation.holeId,
    hole: observation.holeId,
    holeid: observation.holeId,
    lithology: observation.lithology,
  }
  if (field in builtInFields) return builtInFields[field]

  const dimension = dataset.dimensions.find((item) => (
    normalizedField(item.key) === field || normalizedField(item.label) === field
  ))
  if (dimension !== undefined) return observation.dimensions[dimension.key] ?? null

  const variable = dataset.variables.find((item) => (
    normalizedField(item.key) === field
    || normalizedField(item.label) === field
    || normalizedField(item.shortLabel) === field
    || (field === 'clusterid' && item.key === 'multivariate.cluster_id')
  ))
  return variable === undefined ? undefined : observation.values[variable.key] ?? null
}

function comparableRight(raw: string, left: SceneQueryValue): SceneQueryValue {
  const unquoted = raw.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2')
  if (typeof left === 'number') {
    const clusterNumber = /^c(\d+)$/i.exec(unquoted)?.[1]
    const parsed = Number(clusterNumber ?? unquoted)
    return Number.isFinite(parsed) ? parsed : unquoted
  }
  return unquoted
}

export function compileSceneQuery(dataset: EdaDataset, expression: string): CompiledSceneQuery {
  const trimmed = expression.trim()
  if (trimmed.length === 0) return { error: null, matches: () => true }
  const parsed = /^(.+?)\s*(<=|>=|!=|=|<|>)\s*(.+)$/.exec(trimmed)
  if (parsed === null) {
    return { error: 'Use FIELD OPERATOR VALUE, for example Au > 1.', matches: () => true }
  }
  const [, field = '', operator = '=', rawRight = ''] = parsed
  const fieldExists = dataset.observations.some((observation) => observationField(dataset, observation, field) !== undefined)
  if (!fieldExists) {
    return { error: `${field.trim()} is not available in this Data Pool view.`, matches: () => true }
  }

  return {
    error: null,
    matches: (observation) => {
      const left = observationField(dataset, observation, field)
      if (left === undefined || left === null) return false
      const right = comparableRight(rawRight, left)
      if (typeof left === 'number' && typeof right === 'number') {
        if (operator === '<') return left < right
        if (operator === '<=') return left <= right
        if (operator === '>') return left > right
        if (operator === '>=') return left >= right
        if (operator === '!=') return left !== right
        return left === right
      }
      const leftText = String(left).toLowerCase()
      const rightText = String(right).toLowerCase()
      if (operator === '!=') return leftText !== rightText
      if (operator === '=') return leftText === rightText
      if (operator === '<') return leftText < rightText
      if (operator === '<=') return leftText <= rightText
      if (operator === '>') return leftText > rightText
      return leftText >= rightText
    },
  }
}

export function distanceToSection(
  observation: EdaObservation,
  centre: { x: number; y: number },
  azimuth: number,
) {
  const radians = azimuth * Math.PI / 180
  const deltaX = observation.easting - centre.x
  const deltaY = observation.northing - centre.y
  return deltaX * Math.cos(radians) - deltaY * Math.sin(radians)
}
