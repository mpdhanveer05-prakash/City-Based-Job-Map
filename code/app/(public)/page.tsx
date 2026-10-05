import Link from "next/link";
import { CityTile } from "@/components/city/city-tile";
import { loadAllCities } from "@/lib/data/city-data";

/** Cities that are not open yet. Plain text, never links (design-system.md §5). */
const COMING_SOON = ["Hyderabad", "Pune", "Mumbai"];

export default function HomePage() {
  const cities = loadAllCities();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:px-6">
      <header>
        <p className="text-base font-bold">Company Map</p>
      </header>
      <main className="mt-12 sm:mt-18">
        <h1 className="max-w-[30ch] text-4xl font-bold">Find companies by where they work.</h1>
        <p className="mt-4 max-w-[60ch] text-lg text-muted-foreground">
          Choose a city, find a company on the map, and apply on the employer&apos;s own site.
        </p>
        <ul aria-label="Cities" className="mt-12 grid gap-px border border-rule bg-rule sm:grid-cols-2" data-testid="city-list">
          {cities.map((city) => (
            <li key={city.slug} className="bg-background">
              <CityTile city={city} />
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-muted-foreground" data-testid="coming-soon">
          Coming soon: {COMING_SOON.join(", ")}
        </p>
      </main>
      <footer className="mt-12 border-t border-rule pt-4 text-sm">
        <Link href="/suggest" className="inline-flex min-h-11 items-center" data-testid="suggest-link">
          Suggest a company
        </Link>
      </footer>
    </div>
  );
}
