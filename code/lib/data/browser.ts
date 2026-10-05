// The browser's side of the city datasets (P4-03): fetches the files the build wrote and checks their
// shape. The files are our own output, so this is a guard against a half-deployed or cached mismatch (a
// file from another data version, a truncated body), not against hostile input.
import type { CompaniesFile, OfficesFile, SearchFile } from "../filters/dataset";

/** The URLs of one city's current files, read from the manifest at build time and passed down as props. */
export type CityFilePaths = { companies: string; offices: string; search: string };

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "The city data has been updated since this page loaded. Reload the page to get the new data."
        : `The city data could not be loaded (HTTP ${response.status}).`,
    );
  }
  return (await response.json()) as T;
}

export async function fetchCityFiles(paths: CityFilePaths, signal?: AbortSignal): Promise<{ companies: CompaniesFile; offices: OfficesFile }> {
  const [companies, offices] = await Promise.all([getJson<CompaniesFile>(paths.companies, signal), getJson<OfficesFile>(paths.offices, signal)]);
  if (companies.version !== 1 || !Array.isArray(companies.companies) || offices.version !== 1 || !Array.isArray(offices.offices)) {
    throw new Error("The city data is in a format this page does not understand. Reload the page.");
  }
  return { companies, offices };
}

/** The job titles and founder names a search also matches. Loaded when the visitor first searches. */
export async function fetchSearchFile(path: string, signal?: AbortSignal): Promise<SearchFile> {
  const search = await getJson<SearchFile>(path, signal);
  if (search.version !== 1 || !Array.isArray(search.entries)) throw new Error("The search data is in a format this page does not understand.");
  return search;
}
