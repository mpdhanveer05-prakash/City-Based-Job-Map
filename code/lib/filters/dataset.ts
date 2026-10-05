// The static per-city dataset (ADR-0006, P4-01).
//
// The build reads `city_build_snapshot(city)` once, validates it here, and writes four files per city:
//   companies.json  what the explorer needs to draw and filter: the city, reference lists, one
//                   summary per company
//   offices.json    one point per published office
//   search.json     the text a search matches that is not in the other files: active job titles
//                   and published founder names (loaded when a visitor first types a search)
//   details.json    what only the company pages need: description, links, and the jobs to list
// The browser merges the first three into a `CityDataset` and filters it with `lib/filters/filter.ts`.
import { z } from "zod";
import { COMPANY_TYPES, STARTUP_STAGES, slugSchema } from "./schema.ts";

const isoOrNull = z.string().nullable();

const refSchema = z.object({ slug: slugSchema, name: z.string().min(1) });

const companySchema = z.object({
  id: z.guid(),
  slug: slugSchema,
  name: z.string().min(1),
  logo_key: z.string().nullable(),
  description: z.string().nullable(),
  website_url: z.string().regex(/^https:\/\//),
  careers_url: z.string().regex(/^https:\/\//).nullable(),
  startup_stage: z.enum(STARTUP_STAGES).nullable(),
  last_verified_at: isoOrNull,
  types: z.array(z.enum(COMPANY_TYPES)),
  sectors: z.array(slugSchema),
  founders: z.array(z.string().min(1)),
});

const officeSchema = z.object({
  id: z.guid(),
  company_id: z.guid(),
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  accuracy: z.enum(["rooftop", "building", "campus", "street", "locality"]),
  address: z.string(),
  neighbourhood: slugSchema.nullable(),
  tech_park: slugSchema.nullable(),
});

const jobSchema = z.object({
  id: z.guid(),
  company_id: z.guid(),
  title: z.string().min(1),
  apply_url: z.string().regex(/^https:\/\//),
  status: z.enum(["active", "suspect"]),
  last_checked_at: isoOrNull,
});

const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const ring = z.array(position).min(4);

/** The city limit as the build simplified it: GeoJSON, a MultiPolygon in the database. */
const boundarySchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(ring).min(1)).min(1),
});
export type CityBoundary = z.infer<typeof boundarySchema>;

const citySchema = z.object({
  slug: slugSchema,
  name: z.string().min(1),
  aliases: z.array(z.string()),
  status: z.enum(["draft", "beta", "live"]),
  centre: z.tuple([z.number(), z.number()]),
  default_zoom: z.number(),
  data_version: z.number().int().positive(),
  boundary: boundarySchema,
});

/** What `city_build_snapshot` returns. Validated at build time: it is an external input. */
export const citySnapshotSchema = z.object({
  version: z.literal(1),
  city: citySchema,
  /** How many of `companies` are synthetic sample data (`company.is_synthetic`). */
  synthetic_companies: z.number().int().nonnegative(),
  /** Old slugs of these companies and the slug each now has. Build-time only: they become `_redirects` rules (P6-01). */
  slug_redirects: z.array(z.object({ old_slug: slugSchema, new_slug: slugSchema })),
  neighbourhoods: z.array(refSchema),
  tech_parks: z.array(refSchema),
  sectors: z.array(refSchema),
  companies: z.array(companySchema),
  offices: z.array(officeSchema),
  jobs: z.array(jobSchema),
});
export type CitySnapshot = z.infer<typeof citySnapshotSchema>;

export type CityInfo = z.infer<typeof citySchema>;
export type Ref = z.infer<typeof refSchema>;
export type Office = z.infer<typeof officeSchema>;
export type SnapshotJob = z.infer<typeof jobSchema>;

/** A company as the explorer needs it. */
export type CompanySummary = Pick<
  z.infer<typeof companySchema>,
  "id" | "slug" | "name" | "logo_key" | "startup_stage" | "types" | "sectors"
> & {
  /** Active jobs listed in this city. In the summary, not only in search.json, so the popup and the list are right before a search loads. */
  open_jobs: number;
};

export type CompaniesFile = {
  version: 1;
  /** True when every company here is synthetic sample data. The pages label it, and a release build refuses it. */
  synthetic: boolean;
  city: CityInfo;
  neighbourhoods: Ref[];
  tech_parks: Ref[];
  sectors: Ref[];
  companies: CompanySummary[];
};

export type OfficesFile = { version: 1; offices: Office[] };

export type SearchEntry = {
  company_id: string;
  /** Titles of the company's active jobs listed in this city. */
  jobs: string[];
  /** Names of its published founders. */
  founders: string[];
};
export type SearchFile = { version: 1; entries: SearchEntry[] };

export type DetailsFile = {
  version: 1;
  companies: Record<
    string,
    { description: string | null; website_url: string; careers_url: string | null; last_verified_at: string | null }
  >;
  jobs: SnapshotJob[];
};

export type CityDatasetFiles = {
  companies: CompaniesFile;
  offices: OfficesFile;
  search: SearchFile;
  details: DetailsFile;
};

/** What the browser filters: the first three files merged. */
export type CityDataset = {
  synthetic: boolean;
  city: CityInfo;
  neighbourhoods: Ref[];
  tech_parks: Ref[];
  sectors: Ref[];
  companies: CompanySummary[];
  offices: Office[];
  search: SearchEntry[];
};

/**
 * Whether a snapshot is synthetic sample data: all of its companies are. A mix of real and synthetic
 * companies is an error (the sample data must never sit beside real records), so it throws.
 */
export function snapshotIsSynthetic(snapshot: CitySnapshot): boolean {
  const count = snapshot.synthetic_companies;
  const total = snapshot.companies.length;
  if (count > 0 && count < total) {
    throw new Error(`${snapshot.city.slug}: ${count} of ${total} companies are synthetic; real and sample data must not be mixed`);
  }
  return total > 0 && count === total;
}

/** Splits a validated snapshot into the four files. Deterministic: same snapshot, same files. */
export function splitSnapshot(snapshot: CitySnapshot): CityDatasetFiles {
  const activeJobs = new Map<string, string[]>();
  for (const job of snapshot.jobs) {
    if (job.status !== "active") continue;
    const list = activeJobs.get(job.company_id) ?? [];
    list.push(job.title);
    activeJobs.set(job.company_id, list);
  }

  const entries: SearchEntry[] = [];
  for (const c of snapshot.companies) {
    const jobs = activeJobs.get(c.id) ?? [];
    if (jobs.length || c.founders.length) entries.push({ company_id: c.id, jobs, founders: c.founders });
  }

  return {
    companies: {
      version: 1,
      synthetic: snapshotIsSynthetic(snapshot),
      city: snapshot.city,
      neighbourhoods: snapshot.neighbourhoods,
      tech_parks: snapshot.tech_parks,
      sectors: snapshot.sectors,
      companies: snapshot.companies.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        logo_key: c.logo_key,
        startup_stage: c.startup_stage,
        types: c.types,
        sectors: c.sectors,
        open_jobs: activeJobs.get(c.id)?.length ?? 0,
      })),
    },
    offices: { version: 1, offices: snapshot.offices },
    search: { version: 1, entries },
    details: {
      version: 1,
      companies: Object.fromEntries(
        snapshot.companies.map((c) => [
          c.id,
          {
            description: c.description,
            website_url: c.website_url,
            careers_url: c.careers_url,
            last_verified_at: c.last_verified_at,
          },
        ]),
      ),
      jobs: snapshot.jobs,
    },
  };
}

/** Merges the files the explorer loads into one dataset. */
export function mergeDataset(files: Pick<CityDatasetFiles, "companies" | "offices" | "search">): CityDataset {
  return {
    synthetic: files.companies.synthetic,
    city: files.companies.city,
    neighbourhoods: files.companies.neighbourhoods,
    tech_parks: files.companies.tech_parks,
    sectors: files.companies.sectors,
    companies: files.companies.companies,
    offices: files.offices.offices,
    search: files.search.entries,
  };
}
