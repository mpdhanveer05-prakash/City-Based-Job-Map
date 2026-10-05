// Reading an audit entry (P7-02): which fields an update changed. Pure, so it is unit-tested.

/** The fields whose value differs between the snapshots, in a stable order. `updated_at` alone never counts. */
export function changedKeys(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((k) => k !== "updated_at" && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .sort();
}
