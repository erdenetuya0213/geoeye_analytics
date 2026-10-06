/// <reference lib="webworker" />
import { runMineralAssessment, type MineralAssessmentConfiguration } from './mineralSystems.js'
import type { EdaDataset } from '../data/edaTypes.js'

self.addEventListener('message', (event: MessageEvent<{ datasets: EdaDataset[]; configuration: MineralAssessmentConfiguration; requestId: string }>) => {
  try {
    self.postMessage({ requestId: event.data.requestId, result: runMineralAssessment(event.data.datasets, event.data.configuration, event.data.requestId) })
  } catch (error) {
    self.postMessage({ requestId: event.data.requestId, error: error instanceof Error ? error.message : 'Mineral-system assessment failed.' })
  }
})
