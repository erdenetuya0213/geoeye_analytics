import type { EdaObservation } from '../analysis/eda.js'

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
  source: 'demo' | 'live'
  support: string
  variables: readonly EdaVariableDefinition[]
}
