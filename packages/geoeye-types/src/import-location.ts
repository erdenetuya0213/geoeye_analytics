/** Shared CSV location contract for local analytics and database publication. */
export function normalizedHoleIdentifier(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function importLocationColumns(columns: readonly string[]) {
  const find = (aliases: string[]) => columns.findIndex(column => aliases.includes(normalizedHoleIdentifier(column)))
  return {
    hole: find(['holeid', 'hole', 'drillhole', 'drillholeid', 'borehole', 'boreholeid', 'bhid']),
    from: find(['from', 'fromm', 'depthfrom', 'depthfromm', 'fromdepth', 'startdepth', 'startdepthm']),
    to: find(['to', 'tom', 'depthto', 'depthtom', 'todepth', 'enddepth', 'enddepthm']),
    depth: find(['depth', 'depthm', 'measureddepth', 'measureddepthm', 'md', 'mdm']),
  }
}

export function readImportLocation(row: readonly string[], columns: ReturnType<typeof importLocationColumns>) {
  const number = (index: number) => {
    const text = index < 0 ? '' : row[index]?.trim() ?? ''
    if (!text) return null
    const value = Number(text.replace(/,/g, ''))
    return Number.isFinite(value) && value >= 0 ? value : null
  }
  const hole = columns.hole < 0 ? '' : row[columns.hole]?.trim() ?? ''
  const from = columns.from >= 0 ? number(columns.from) : number(columns.depth)
  const to = columns.to >= 0 ? number(columns.to) : from
  const valid = hole.length > 0 && from !== null && to !== null && to >= from
  return { hole, depthFrom: from, depthTo: to, valid,
    key: valid ? JSON.stringify([normalizedHoleIdentifier(hole), from, to]) : null }
}
