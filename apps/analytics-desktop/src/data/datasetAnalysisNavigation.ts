import type { EdaDataset } from './edaTypes.js'
import { clearPersistedState, writePersistedState, type PersistentStorage } from '../state/persistentState.js'

/** Prepare the chosen local dataset before mounting either analysis page. */
export function prepareDatasetAnalysis(storage: PersistentStorage, dataset: EdaDataset, target: 'explore' | 'multivariate') {
  const numeric = dataset.variables.filter((variable) => variable.dataType !== 'category')
  writePersistedState(storage, `${target}.datasetId`, dataset.id)
  writePersistedState(storage, `${target}.variableKeys`, numeric.slice(0, target === 'explore' ? 3 : 6).map((variable) => variable.key))
  writePersistedState(storage, `${target}.activeFilterKeys`, [])
  writePersistedState(storage, `${target}.filterValues`, {})
  writePersistedState(storage, `${target}.secondGroup`, null)
  writePersistedState(storage, `${target}.${target === 'explore' ? 'compareBy' : 'groupBy'}`, null)
  clearPersistedState(storage, `${target}.activeRun`)
  if (target === 'explore') {
    clearPersistedState(storage, 'explore.activeRunId')
    clearPersistedState(storage, 'explore.activePopulationId')
    writePersistedState(storage, 'explore.view', 'statistics')
    writePersistedState(storage, 'explore.datasetHandoff', true)
    writePersistedState(storage, 'explore.relationshipDatasetIds', [dataset.id])
    writePersistedState(storage, 'explore.xDatasetId', dataset.id)
    writePersistedState(storage, 'explore.yDatasetId', dataset.id)
    writePersistedState(storage, 'explore.xVariableKey', numeric[0]?.key ?? '')
    writePersistedState(storage, 'explore.yVariableKey', numeric[1]?.key ?? numeric[0]?.key ?? '')
  } else {
    writePersistedState(storage, 'multivariate.analysisMode', 'population')
    writePersistedState(storage, 'multivariate.view', 'overview')
    writePersistedState(storage, 'multivariate.hasRun', false)
  }
}
