// Build-time reader for the city datasets that `npm run data` wrote to public/data (P4-01, P4-02).
// Server Components call this while `next build` prerenders: the pages are static, so nothing here
// runs for a visitor. The browser reads the same files over HTTP (lib/data/browser.ts).
//
// Not for client code: it uses node:fs.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { CompaniesFile, DetailsFile, OfficesFile, SearchFile } from "../filters/dataset.ts";
import type { Manifest } from "../filters/dataset-files.ts";
import { CITY_SLUGS, type CitySlug } from "../filters/schema.ts";

const DATA_ROOT = path.join(process.cwd(), "public", "data");

function readJson<T>(relative: string): T {
  const file = path.join(DATA_ROOT, relative);
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (error) {
    throw new Error(
      `Cannot read ${path.relative(process.cwd(), file)} (${error instanceof Error ? error.message : "unknown error"}). Run \`npm run data\` first: the build does this for you.`,
    );
  }
}

let manifestCache: Manifest | undefined;

export function loadManifest(): Manifest {
  manifestCache ??= readJson<Manifest>("manifest.json");
  return manifestCache;
}

export type CityFiles = {
  slug: CitySlug;
  dataVersion: number;
  synthetic: boolean;
  companies: CompaniesFile;
  offices: OfficesFile;
  search: SearchFile;
  details: DetailsFile;
};

const cityCache = new Map<CitySlug, CityFiles>();

/** Every file of one city's current dataset. */
export function loadCity(slug: CitySlug): CityFiles {
  const cached = cityCache.get(slug);
  if (cached) return cached;
  const entry = loadManifest().cities[slug];
  if (!entry) throw new Error(`The manifest has no dataset for ${slug}`);
  // The manifest paths are URLs (/data/<city>/<version>/<file>.json); the files sit under public/.
  const file = (name: keyof typeof entry.files) => entry.files[name].path.replace(/^\/data\//, "");
  const files: CityFiles = {
    slug,
    dataVersion: entry.data_version,
    synthetic: entry.synthetic,
    companies: readJson<CompaniesFile>(file("companies")),
    offices: readJson<OfficesFile>(file("offices")),
    search: readJson<SearchFile>(file("search")),
    details: readJson<DetailsFile>(file("details")),
  };
  cityCache.set(slug, files);
  return files;
}

export function loadAllCities(): CityFiles[] {
  return CITY_SLUGS.filter((slug) => loadManifest().cities[slug]).map(loadCity);
}

/** True when any city's dataset is synthetic sample data: the pages then say so. */
export function anySynthetic(): boolean {
  return Object.values(loadManifest().cities).some((c) => c.synthetic);
}
