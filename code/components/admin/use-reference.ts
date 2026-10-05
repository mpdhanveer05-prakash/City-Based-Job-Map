"use client";

import { useQuery } from "@tanstack/react-query";
import { useAdmin } from "./admin-root";

export type Reference = {
  cities: Array<{ id: number; slug: string; name: string; aliases: string[] }>;
  neighbourhoods: Array<{ id: number; city_id: number; slug: string; name: string }>;
  techParks: Array<{ id: number; city_id: number; slug: string; name: string }>;
  sectors: Array<{ id: number; slug: string; name: string }>;
  sources: Array<{ id: number; name: string }>;
};

/** The lists the forms choose from. Any admin may read them (row-level security). Small, so fetched once and cached. */
export function useReference() {
  const { supabase } = useAdmin();
  return useQuery({
    queryKey: ["admin", "reference"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Reference> => {
      const [cities, neighbourhoods, techParks, sectors, sources] = await Promise.all([
        supabase.from("city").select("id, slug, name, aliases").order("name"),
        supabase.from("neighbourhood").select("id, city_id, slug, name").order("name"),
        supabase.from("tech_park").select("id, city_id, slug, name").order("name"),
        supabase.from("sector").select("id, slug, name").order("name"),
        supabase.from("source").select("id, name").order("name"),
      ]);
      for (const r of [cities, neighbourhoods, techParks, sectors, sources]) if (r.error) throw r.error;
      return {
        cities: cities.data ?? [],
        neighbourhoods: neighbourhoods.data ?? [],
        techParks: techParks.data ?? [],
        sectors: sectors.data ?? [],
        sources: sources.data ?? [],
      };
    },
  });
}

/** Postgres errors from supabase-js are plain objects with `code` and `message`; this keeps the type honest for `describeError`. */
export type AnyError = { code?: string | null; message?: string | null; details?: string | null; hint?: string | null };
