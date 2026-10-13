import type { EdaDataset } from '../data/edaTypes.js'
import type { EdaObservation } from './eda.js'

export interface CompositeOptions {
  /** Target composite length in metres. */
  length: number
  /** Residual no longer than this fraction of `length` is merged into the previous composite; otherwise kept. */
  minimumFraction?: number
  /** Composite downhole from each hole's first sample (default) or from a fixed depth. */
  startAt?: 'first-sample' | number
}

export interface CompositeStats { holes: number; input: number; output: number; meanLength: number; merged: number }

/** Fixed-length, length-weighted compositing. Numeric values: weighted mean; categories: length-majority. */
export function compositeDataset(dataset: EdaDataset, options: CompositeOptions): { dataset: EdaDataset; stats: CompositeStats } {
  const length = options.length
  const minFraction = options.minimumFraction ?? 0.5
  if (!(length > 0)) throw new Error('Composite length must be positive')
  const byHole = new Map<string, EdaObservation[]>()
  for (const o of dataset.observations) { const list = byHole.get(o.holeId); if (list) list.push(o); else byHole.set(o.holeId, [o]) }
  const out: EdaObservation[] = []
  let merged = 0
  const numericKeys = dataset.variables.filter((v) => v.dataType !== 'category').map((v) => v.key)
  const categoryKeys = dataset.variables.filter((v) => v.dataType === 'category').map((v) => v.key)

  for (const [holeId, samples] of byHole) {
    samples.sort((a, b) => a.depthFrom - b.depthFrom)
    const first = samples[0]; const last = samples.at(-1)
    if (first === undefined || last === undefined) continue
    const start = options.startAt === undefined || options.startAt === 'first-sample' ? first.depthFrom : options.startAt
    const end = last.depthTo
    const bins: Array<{ from: number; to: number }> = []
    for (let from = start; from < end - 1e-9; from += length) bins.push({ from, to: Math.min(from + length, end) })
    const tail = bins.at(-1)
    if (bins.length > 1 && tail !== undefined && tail.to - tail.from <= length * minFraction + 1e-9) { bins.pop(); const prev = bins.at(-1); if (prev) { prev.to = tail.to; merged += 1 } }

    let cursor = 0
    bins.forEach((bin, index) => {
      while (cursor < samples.length && (samples[cursor]?.depthTo ?? 0) <= bin.from) cursor += 1
      const sums: Record<string, { value: number; weight: number }> = {}
      const cats: Record<string, Map<string, number>> = {}
      let covered = 0, east = 0, north = 0, ids: string[] = [], joinKey = ''
      for (let i = cursor; i < samples.length; i += 1) {
        const s = samples[i]; if (s === undefined || s.depthFrom >= bin.to) break
        const w = Math.min(s.depthTo, bin.to) - Math.max(s.depthFrom, bin.from)
        if (w <= 0) continue
        covered += w; east += s.easting * w; north += s.northing * w; ids.push(...(s.sourceObservationIds ?? [s.sourceObservationId])); joinKey = joinKey || s.joinKey
        for (const key of numericKeys) { const v = s.values[key]; if (v === null || v === undefined || !Number.isFinite(v)) continue; const acc = sums[key] ?? (sums[key] = { value: 0, weight: 0 }); acc.value += v * w; acc.weight += w }
        for (const key of categoryKeys) { const c = s.dimensions[key]; if (!c) continue; const m = cats[key] ?? (cats[key] = new Map()); m.set(c, (m.get(c) ?? 0) + w) }
        const lith = s.lithology; if (lith) { const m = cats.lithology ?? (cats.lithology = new Map()); m.set(lith, (m.get(lith) ?? 0) + w) }
      }
      if (covered <= 0) return
      const values: Record<string, number | null> = {}
      for (const key of numericKeys) { const acc = sums[key]; values[key] = acc && acc.weight > 0 ? acc.value / acc.weight : null }
      const dims: Record<string, string> = {}
      for (const [key, m] of Object.entries(cats)) dims[key] = [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
      const id = `${holeId}:${bin.from.toFixed(2)}-${bin.to.toFixed(2)}`
      out.push({ id, holeId, depthFrom: bin.from, depthTo: bin.to, easting: east / covered, northing: north / covered, dimensions: dims, lithology: dims.lithology ?? '', sampleId: `C${index + 1}`, sourceObservationId: id, sourceObservationIds: [...new Set(ids)], joinKey, values, locationValid: true })
    })
  }
  const meanLength = out.length === 0 ? 0 : out.reduce((s, o) => s + (o.depthTo - o.depthFrom), 0) / out.length
  return {
    dataset: { ...dataset, id: `${dataset.id}:comp${length}`, name: `${dataset.name} · ${length} m composites`, observations: out, support: `${length} m composite` },
    stats: { holes: byHole.size, input: dataset.observations.length, output: out.length, meanLength, merged },
  }
}

/** Restrict a dataset to a saved domain class (by observation or source-observation ids). */
export function filterDatasetByIds(dataset: EdaDataset, ids: ReadonlySet<string>, label: string): EdaDataset {
  const observations = dataset.observations.filter((o) => ids.has(o.id) || ids.has(o.sourceObservationId) || (o.sourceObservationIds ?? []).some((id) => ids.has(id)))
  return { ...dataset, id: `${dataset.id}:${label}`, name: `${dataset.name} · ${label}`, observations }
}
