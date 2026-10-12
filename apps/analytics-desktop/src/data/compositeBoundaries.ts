import type { DatabaseRmrSource } from './geotechnicalDatabase.js'

/** Field semantics: merge image-row fragments with the same selected field
 * state; keep gaps and changes as boundaries, never use unrelated columns. */
export function selectedFieldSpans(source: DatabaseRmrSource | undefined, holeId: string, fieldKey: string) {
  const rows = (source?.records ?? []).filter(row => row.holeId === holeId
    && row.depthFrom !== null && row.depthTo !== null && row.depthTo > row.depthFrom
    && row.values[fieldKey] != null && String(row.values[fieldKey]).trim() !== '')
  const depths = [...new Set(rows.flatMap(row => [row.depthFrom!, row.depthTo!]))].sort((a, b) => a - b)
  const spans: Array<{ depthFrom: number; depthTo: number; state: string }> = []
  for (let index = 0; index < depths.length - 1; index++) {
    const from = depths[index]!, to = depths[index + 1]!
    const values = [...new Set(rows.filter(row => row.depthFrom! <= from && row.depthTo! >= to)
      .map(row => JSON.stringify(row.values[fieldKey])))].sort()
    if (!values.length) continue
    const state = JSON.stringify(values), previous = spans.at(-1)
    if (previous?.depthTo === from && previous.state === state) previous.depthTo = to
    else spans.push({ depthFrom: from, depthTo: to, state })
  }
  return spans
}

/** Restart the fixed-length grid at each selected state boundary, as Field does. */
export function splitFieldSpans(spans: Array<{ depthFrom: number; depthTo: number }>, length: number, start: number, end: number, boundaries: number[]) {
  const result: Array<{ depthFrom: number; depthTo: number; exclusionReason?: string }> = []
  for (const span of spans) {
    let from = Math.max(start, span.depthFrom)
    const maximum = Math.min(end, span.depthTo)
    while (from < maximum - 1e-7) {
      const planned = Math.min(maximum, from + length)
      const to = boundaries.find(depth => depth > from + 1e-7 && depth < planned - 1e-7) ?? planned
      result.push({ depthFrom: from, depthTo: to })
      from = to
      if (result.length > 100000) throw new Error('Too many composite intervals.')
    }
  }
  return result
}
