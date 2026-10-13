import type { EdaObservation } from '../analysis/eda.js'

export type { EdaObservation }

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

/** Where a dataset came from. Set when the dataset is built; guessed from its name only for Database datasets. */
export type EdaDatasetKind = 'integrated' | 'drillholes' | 'logging' | 'laboratory' | 'strength' | 'xrf' | 'spectral' | 'operations' | 'other'

export interface EdaDataset {
  dimensions: readonly EdaDimensionDefinition[]
  id: string
  kind?: EdaDatasetKind
  name: string
  observations: EdaObservation[]
  producer: string
  project: string
  snapshotAt: string
  source: 'demo' | 'live'
  support: string
  variables: readonly EdaVariableDefinition[]
}
