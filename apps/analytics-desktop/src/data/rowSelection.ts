export function toggleRowSelection<T>(selected: ReadonlySet<T>, id: T): Set<T> {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** Select All applies to the current search, preserving selections outside it. */
export function toggleVisibleSelection<T>(selected: ReadonlySet<T>, visible: readonly T[]): Set<T> {
  const next = new Set(selected)
  const remove = visible.length > 0 && visible.every(id => selected.has(id))
  for (const id of visible) { if (remove) next.delete(id); else next.add(id) }
  return next
}
