import type { StructureType, VariogramModel, VariogramStructure } from './engineClient.js'

export function structureValue(type: StructureType, h: number, range: number): number {
  const r = h / Math.max(range, 1e-9)
  if (type === 'spherical') return r < 1 ? 1.5 * r - 0.5 * r ** 3 : 1
  if (type === 'exponential') return 1 - Math.exp(-3 * r)
  return 1 - Math.exp(-3 * r * r)
}

export function modelGamma(model: VariogramModel, h: number, directionIndex: number): number {
  return model.structures.reduce((g, s) => g + s.sill * structureValue(s.type, h, s.ranges[directionIndex] ?? s.ranges[0] ?? 1), model.nugget)
}

export function modelCurve(model: VariogramModel, hMax: number, directionIndex: number, points = 80): Array<[number, number]> {
  return Array.from({ length: points + 1 }, (_, i) => { const h = (hMax * i) / points; return [h, modelGamma(model, h, directionIndex)] })
}

export function withTotalSill(model: VariogramModel): VariogramModel {
  return { ...model, totalSill: model.nugget + model.structures.reduce((s, x) => s + x.sill, 0) }
}

export function defaultModel(sill: number, hMax: number, directions = 3): VariogramModel {
  const s = (sill: number, r: number): VariogramStructure => ({ type: 'spherical', sill, ranges: Array.from({ length: directions }, () => r) })
  return withTotalSill({ nugget: 0.1 * sill, structures: [s(0.5 * sill, hMax * 0.25), s(0.4 * sill, hMax * 0.6)], totalSill: sill })
}

/** Range at which the model reaches `fraction` of total sill — for continuity roses. */
export function practicalRange(model: VariogramModel, directionIndex: number, hMax: number, fraction = 0.95): number {
  const target = model.totalSill * fraction
  let lo = 0, hi = hMax
  for (let i = 0; i < 40; i += 1) { const mid = (lo + hi) / 2; if (modelGamma(model, mid, directionIndex) < target) lo = mid; else hi = mid }
  return hi
}
