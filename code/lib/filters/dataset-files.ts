// Turns a validated snapshot into the files the build writes (P4-01), and the manifest that names
// them. Pure: the build script does the reading and writing, so this is easy to test.
import { snapshotIsSynthetic, splitSnapshot, type CitySnapshot } from "./dataset.ts";

export const DATASET_FILE_NAMES = ["companies", "offices", "search", "details"] as const;
export type DatasetFileName = (typeof DATASET_FILE_NAMES)[number];

/** The URL path a dataset file is served from, relative to the site root. */
export function datasetPath(city: string, dataVersion: number, name: DatasetFileName): string {
  return `/data/${city}/${dataVersion}/${name}.json`;
}

export type SerializedDataset = {
  city: string;
  dataVersion: number;
  /** True when every company is synthetic sample data. */
  synthetic: boolean;
  counts: { companies: number; offices: number; jobs: number };
  /** The company slugs in this city and its slug redirects, for the build's `_redirects` (not written to the dataset files). */
  slugs: string[];
  slugRedirects: Array<{ old_slug: string; new_slug: string }>;
  /** The JSON text of each file (compact, in a fixed key order, so equal data gives equal bytes). */
  files: Record<DatasetFileName, string>;
};

export function serializeDataset(snapshot: CitySnapshot): SerializedDataset {
  const split = splitSnapshot(snapshot);
  return {
    city: snapshot.city.slug,
    dataVersion: snapshot.city.data_version,
    synthetic: snapshotIsSynthetic(snapshot),
    slugs: snapshot.companies.map((c) => c.slug),
    slugRedirects: snapshot.slug_redirects,
    counts: {
      companies: snapshot.companies.length,
      offices: snapshot.offices.length,
      jobs: snapshot.jobs.length,
    },
    files: {
      companies: JSON.stringify(split.companies),
      offices: JSON.stringify(split.offices),
      search: JSON.stringify(split.search),
      details: JSON.stringify(split.details),
    },
  };
}

export type Manifest = {
  version: 1;
  cities: Record<
    string,
    {
      data_version: number;
      synthetic: boolean;
      counts: SerializedDataset["counts"];
      files: Record<DatasetFileName, { path: string; bytes: number }>;
    }
  >;
};

/**
 * What the browser reads first to find the current files for each city. It has no timestamp, so a
 * rebuild with unchanged data gives byte-identical output.
 */
export function buildManifest(sets: readonly SerializedDataset[]): Manifest {
  const cities: Manifest["cities"] = {};
  for (const set of [...sets].sort((a, b) => (a.city < b.city ? -1 : 1))) {
    const files = {} as Manifest["cities"][string]["files"];
    for (const name of DATASET_FILE_NAMES) {
      files[name] = { path: datasetPath(set.city, set.dataVersion, name), bytes: new TextEncoder().encode(set.files[name]).length };
    }
    cities[set.city] = { data_version: set.dataVersion, synthetic: set.synthetic, counts: set.counts, files };
  }
  return { version: 1, cities };
}
