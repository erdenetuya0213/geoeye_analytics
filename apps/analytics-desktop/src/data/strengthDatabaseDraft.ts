import type { TabularImportInput } from '@geoeye/datapool-client'
import type { PointLoadRecord } from './pointLoadStore.js'
import type { SchmidtRecord } from './schmidtStore.js'

export function strengthDatabaseDraft(pointLoad: readonly PointLoadRecord[], schmidt: readonly SchmidtRecord[]): TabularImportInput {
  const columns = ['Method', 'Sample ID', 'Hole ID', 'From', 'To', 'Peak Load kN', 'Equivalent Diameter mm', 'Is50 MPa', 'Schmidt Rebound', 'Laboratory', 'Tested At', 'Valid', 'Test Type', 'Failure Type', 'Source File']
  const labColumns = [...new Set(pointLoad.flatMap(record => Object.keys(record.sourceValues ?? {})))]
  columns.push(...labColumns.map(column => `Lab: ${column}`))
  const pointLoadRows = pointLoad.map((record) => [
    'Point load', record.sampleId, record.holeId, String(record.depthFromM), String(record.depthToM),
    String(record.peakLoadKn), String(record.equivalentDiameterMm), String(record.is50Mpa), '',
    record.labName, record.testedAt, String(record.validBreak), record.testType, record.sourceValues?.['Failure Type'] ?? '', record.sourceFile ?? '', ...labColumns.map(column => record.sourceValues?.[column] ?? ''),
  ])
  const schmidtRows = schmidt.map((record) => [
    'Schmidt rebound', record.sampleId, record.holeId, String(record.depthFromM), String(record.depthToM),
    '', '', '', String(record.reboundValue), '', '', 'true', '', '', record.sourceFile, ...labColumns.map(() => ''),
  ])
  return { columns, fileName: 'strength-local-records.csv', rows: [...pointLoadRows, ...schmidtRows], section: 'strength' }
}
