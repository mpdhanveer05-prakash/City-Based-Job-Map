// Reads `city_build_snapshot(city)` from Supabase at build time (ADR-0006). Build-time only: the
// result is written into the static export, and nothing here runs in the browser or holds a secret.
// It uses the public anon key, so Row-Level Security decides what comes back: published rows only.
import { citySnapshotSchema, type CitySnapshot } from "../filters/dataset.ts";

export type SnapshotSource = { url: string; anonKey: string };

/**
 * Calls the RPC over PostgREST and validates the answer. It throws, never returns partial data: a
 * build with a half-read city must fail instead of publishing an incomplete dataset.
 */
export async function fetchCitySnapshot(
  source: SnapshotSource,
  citySlug: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CitySnapshot> {
  const base = source.url.replace(/\/+$/, "");
  const response = await fetchImpl(`${base}/rest/v1/rpc/city_build_snapshot`, {
    method: "POST",
    headers: {
      apikey: source.anonKey,
      Authorization: `Bearer ${source.anonKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ city_slug: citySlug }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`city_build_snapshot(${citySlug}) failed: HTTP ${response.status} ${detail}`);
  }
  const body: unknown = await response.json();
  if (body === null) {
    throw new Error(`city_build_snapshot(${citySlug}) returned null: the city is unknown or not visible to the anon role`);
  }
  return parseCitySnapshot(body, citySlug);
}

/** Validates a snapshot from any source and checks that it is the city that was asked for. */
export function parseCitySnapshot(body: unknown, citySlug: string): CitySnapshot {
  const parsed = citySnapshotSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `city_build_snapshot(${citySlug}) returned data that does not match the schema: ${first.path.join(".")}: ${first.message}`,
    );
  }
  if (parsed.data.city.slug !== citySlug) {
    throw new Error(`asked for ${citySlug} but received ${parsed.data.city.slug}`);
  }
  return parsed.data;
}
