import type { TabularImportInput } from '@geoeye/datapool-client'
import { headerKey, requiredColumns, type ClassTable } from './classTables.js'
import type { ClassSection } from './classTableStore.js'

export const classColumn: Record<ClassSection, string> = { laboratory: 'Lab class', strength: 'Strength test' }

/** One wide table for the Database and the analysis tools: columns that share a name across classes share a column. */
export function classDatabaseDraft(section: ClassSection, tables: readonly ClassTable[]): TabularImportInput {
  const fields = [...new Map(tables.flatMap(table => table.columns.slice(4)).map(column => [headerKey(column), column])).values()]
  const rows = tables.flatMap(table => {
    const source = fields.map(field => table.columns.findIndex(column => headerKey(column) === headerKey(field)))
    return table.rows.map(row => [table.name, ...row.slice(0, 4), ...source.map(index => row[index] ?? '')])
  })
  return { columns: [classColumn[section], ...requiredColumns, ...fields], fileName: `${section}-local-records.csv`, rows, section }
}
