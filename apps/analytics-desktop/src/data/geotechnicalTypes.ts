import type { GeotechnicalInterval } from '../analysis/geotechnicalWorkflow.js'

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
