import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Explorer, type ExplorerCity } from "@/components/explorer/explorer";
import { loadAllCities, loadCity, loadManifest } from "@/lib/data/city-data";
import { parseCity } from "@/lib/filters/url";

// Every city is a page built ahead of time (ADR-0006). A path that is not a launch city is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return loadAllCities().map((city) => ({ city: city.slug }));
}

export async function generateMetadata({ params }: PageProps<"/[city]">): Promise<Metadata> {
  const slug = parseCity((await params).city);
  if (!slug) return {};
  const { name } = loadCity(slug).companies.city;
  return {
    title: `Companies in ${name}`,
    description: `Find companies in ${name} by where their offices are, look at their open jobs, and apply on the employer's own site.`,
    alternates: { canonical: `/${slug}` },
  };
}

export default async function CityPage({ params }: PageProps<"/[city]">) {
  const slug = parseCity((await params).city);
  if (!slug) notFound();
  const files = loadCity(slug);
  const { city } = files.companies;
  const entry = loadManifest().cities[slug];
  const explorerCity: ExplorerCity = {
    slug,
    name: city.name,
    centre: city.centre,
    defaultZoom: city.default_zoom,
    dataVersion: files.dataVersion,
    synthetic: files.synthetic,
    boundary: city.boundary,
  };
  return (
    // useSearchParams needs a Suspense boundary in a prerendered page; the fallback is what the static HTML holds.
    <Suspense
      fallback={
        <main className="flex-1 p-4" data-testid="explorer-skeleton">
          <h1 className="text-xl font-bold">{city.name}</h1>
          <p className="mt-2 text-muted-foreground">Loading the map…</p>
        </main>
      }
    >
      <Explorer
        city={explorerCity}
        paths={{ companies: entry.files.companies.path, offices: entry.files.offices.path, search: entry.files.search.path }}
      />
    </Suspense>
  );
}
