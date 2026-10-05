// A short, stable name for a filter, used in the map's cluster keys (map-spec §2:
// `c:<data_version>:<filter_hash>:<id>`). A new filter is a new key namespace, so the map cross-fades to it.
import { toSqlFilters, type Filters } from "../filters/schema";

/** FNV-1a over the canonical JSON of the filter, in base 36. The empty filter is "none". */
export function hashFilters(filters: Filters): string {
  const sql = toSqlFilters(filters);
  if (Object.keys(sql).length === 0) return "none";
  const text = JSON.stringify(sql);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
