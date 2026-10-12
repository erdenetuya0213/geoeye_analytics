import { Pool, type PoolClient } from 'pg'
import { expect, it, vi } from 'vitest'
import { PostgresDataPoolStore } from '../src/postgres-store.js'

it('saves RMR variables as derived and preserves exact boreholes when normalized names collide', async () => {
  const variables: unknown[][] = []
  let observations: Array<{ hole_id: string | null; numeric_value: number | null }> = []
  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.includes('INSERT INTO datasets')) return { rows: [{ id: 'dataset', project_id: 'project', name: args[1], description: '', producer_type: args[3], producer_name: args[4], source_system: 'geoeye.analytics.csv', spatial_support: 'interval', status: 'active', current_version: 1, created_at: '2026-10-05', updated_at: '2026-10-05' }] }
    if (sql.includes('INSERT INTO dataset_versions')) return { rows: [{ id: 'version' }] }
    if (sql.includes('FROM drill_holes')) return { rows: [{ id: 'first-hole', name: 'TT-006' }, { id: 'second-hole', name: 'TT_006' }] }
    if (sql.includes('INSERT INTO variable_definitions')) { variables.push(args); return { rows: [{ id: `variable-${variables.length}` }] } }
    if (sql.includes('INSERT INTO observation_values')) observations = JSON.parse(args[4] as string)
    return { rows: [] }
  })
  const pool = new Pool()
  vi.spyOn(pool, 'connect').mockResolvedValue({ query, release: vi.fn() } as unknown as PoolClient)
  try {
    const result = await new PostgresDataPoolStore(pool).saveTabularImport('project', {
      section: 'geotechnical', fileName: 'rmr76-result.csv', columns: ['Hole ID', 'From', 'To', 'RMR76'],
      rows: [['TT-006','0','3','75'], ['TT_006','0','3','50'], ['TT006','3','6','25']],
    }, null)
    expect(result.dataset.producerType).toBe('analytics')
    expect(variables[0]![6]).toBe('derived')
    expect(observations.map(row => row.hole_id)).toEqual(['first-hole','second-hole',null])
    expect(observations.map(row => row.numeric_value)).toEqual([75,50,25])
    expect(result.unmatchedHoles).toEqual(['TT006'])
    expect(query).toHaveBeenCalledWith('COMMIT')
  } finally { await pool.end() }
})
