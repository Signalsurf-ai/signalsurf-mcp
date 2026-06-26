type Counted = { value: string; count: number }

export function aggregatePopularValues(
  entries: Array<{ data: unknown }>,
  fieldKeys: string[],
  topN: number
): Record<string, Counted[]> {
  const counts = new Map<string, Map<string, number>>()

  for (const entry of entries) {
    const data =
      entry.data && typeof entry.data === "object" && !Array.isArray(entry.data)
        ? (entry.data as Record<string, unknown>)
        : {}
    for (const key of fieldKeys) {
      const raw = data[key]
      if (!Array.isArray(raw)) continue
      let perField = counts.get(key)
      if (!perField) {
        perField = new Map<string, number>()
        counts.set(key, perField)
      }
      for (const item of raw) {
        if (typeof item !== "string") continue
        const trimmed = item.trim()
        if (!trimmed) continue
        perField.set(trimmed, (perField.get(trimmed) ?? 0) + 1)
      }
    }
  }

  const result: Record<string, Counted[]> = {}
  for (const [key, perField] of counts) {
    if (perField.size === 0) continue
    result[key] = [...perField.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, topN)
  }
  return result
}
