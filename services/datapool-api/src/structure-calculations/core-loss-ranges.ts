export interface DepthRange { from: number; to: number }

/** Use accepted loss depths, with recovery geometry only as a legacy fallback.
 * Core Logging resolves legacy image rows before passing them here. Combining
 * the two representations can exclude an old location as well as its correction. */
export function locatedCoreLossRanges(row: {
  coreLossIntervals?: readonly { depthFrom: number; depthTo: number }[]
  recovery?: { lossIntervalsM: readonly { fromM: number; toM: number }[] } | null
}): DepthRange[] {
  return row.coreLossIntervals?.map((loss) => ({ from: loss.depthFrom, to: loss.depthTo }))
    ?? (row.recovery?.lossIntervalsM ?? []).map((loss) => ({ from: loss.fromM, to: loss.toM }))
}

/** Located loss only: do not invent depths for unlocated recovery deficits. */
export function mergeDepthRanges(ranges: readonly DepthRange[]): DepthRange[] {
  const merged: DepthRange[] = []
  for (const range of ranges.filter((item) => Number.isFinite(item.from) && Number.isFinite(item.to) && item.to > item.from).slice().sort((a, b) => a.from - b.from)) {
    const previous = merged.at(-1)
    if (previous && range.from <= previous.to + 1e-7) previous.to = Math.max(previous.to, range.to)
    else merged.push({ ...range })
  }
  return merged
}

export function withoutCoreLoss<T extends DepthRange>(range: T, losses: readonly DepthRange[]): T[] {
  let cursor = range.from
  const retained: T[] = []
  for (const loss of mergeDepthRanges(losses)) {
    if (loss.to <= cursor || loss.from >= range.to) continue
    if (loss.from > cursor) retained.push({ ...range, from: cursor, to: loss.from })
    cursor = Math.max(cursor, loss.to)
    if (cursor >= range.to) break
  }
  if (cursor < range.to) retained.push({ ...range, from: cursor, to: range.to })
  return retained
}

export function isCoreLossDepth(depth: number, losses: readonly DepthRange[]) {
  return losses.some((loss) => depth >= loss.from && depth < loss.to)
}
