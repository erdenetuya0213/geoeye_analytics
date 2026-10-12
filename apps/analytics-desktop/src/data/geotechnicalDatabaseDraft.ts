import type { TabularImportInput } from '@geoeye/datapool-client'
import type { Rmr76CalculationRun } from '../analysis/geotechnicalWorkflow.js'

export function geotechnicalDatabaseDraftFileName(runId: string, includeComponents: boolean, name?: string, calculatedAt?: string) {
  if (name && calculatedAt) {
    const label = name.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().replace(/\s+/g, ' ').slice(0, 100)
    return `${label || 'RMR76 results'} - ${calculatedAt.replace(/[:.]/g, '-').replace('T', ' ')}${includeComponents ? ' - components' : ''}.csv`
  }
  return `rmr76-${runId}${includeComponents ? '-components' : ''}.csv`
}

/** A result table, including unresolved rows, so database coverage stays auditable. */
export function geotechnicalDatabaseDraft(run: Rmr76CalculationRun, includeComponents: boolean, name?: string): TabularImportInput {
  const columns = ['Hole ID', 'From', 'To', 'RMR76', 'RMR76 class', 'Rating basis', 'Status', 'Missing inputs', 'Run ID', 'Method version', 'Calculated at', 'Source lineage', 'Basic RMR76', 'UCS MPa', 'RQD percent', 'Joint spacing m', 'Joint condition', 'Groundwater', 'Estimated inputs', 'Exclusion reason', 'Field strength grade']
  if (includeComponents) columns.push('Strength rating', 'RQD rating', 'Joint spacing rating', 'Joint condition rating', 'Groundwater rating', 'Orientation adjustment')
  const rows = run.intervals.map(interval => {
    const calculation = interval.status === 'valid' ? interval.calculation : null
    const row = [interval.holeId, String(interval.depthFrom), String(interval.depthTo),
      calculation?.total == null ? '' : String(calculation.total), calculation?.classification ?? '', calculation?.ratingBasis ?? '',
      interval.status, interval.missing.join(', '), run.runId, run.method.version, run.calculatedAt, JSON.stringify(interval.lineage),
      calculation?.basic == null ? '' : String(calculation.basic),
      ...(['geotech.ucs', 'geotech.rqd', 'structure.joint_spacing', 'geotech.joint_condition', 'geotech.groundwater'] as const).map(key => {
        const input = interval.resolvedInputs[key]
        if (key === 'geotech.ucs' && typeof input.value === 'object') return ''
        return input.availability === 'missing' || input.value == null ? '' : typeof input.value === 'object' ? JSON.stringify(input.value) : String(input.value)
      }), interval.lineage.filter(input => input.availability === 'fallback').map(input => input.canonicalKey).join(', '), interval.exclusionReason ?? '',
      typeof interval.resolvedInputs['geotech.ucs'].value === 'object' && interval.resolvedInputs['geotech.ucs'].value !== null ? JSON.stringify(interval.resolvedInputs['geotech.ucs'].value) : '']
    if (includeComponents) row.push(...[calculation?.scores.strength, calculation?.scores.rqd, calculation?.scores.jointSpacing, calculation?.scores.jointCondition, calculation?.scores.groundwater, calculation?.orientationAdjustment].map(value => value == null ? '' : String(value)))
    return row
  })
  return { section: 'geotechnical', fileName: geotechnicalDatabaseDraftFileName(run.runId, includeComponents, name, run.calculatedAt), columns, rows }
}
