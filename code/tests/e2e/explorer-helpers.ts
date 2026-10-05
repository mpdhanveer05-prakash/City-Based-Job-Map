import { expect, type APIRequestContext, type Page } from "@playwright/test";

// Helpers for the specs that drive the real explorer (/bangalore, /chennai). Markers' positions come from the layer's
// own last frame, so a tap lands exactly where a marker was drawn.

export type Drawn = { key: string; kind: string; x: number; y: number; radius: number; selected: boolean; opacity: number };

type Manifest = { cities: Record<string, { data_version: number; synthetic: boolean; counts: { companies: number; offices: number; jobs: number }; files: Record<string, { path: string }> }> };

export type Company = { id: string; slug: string; name: string; types: string[]; startup_stage: string | null; sectors: string[]; open_jobs: number };
export type Office = { id: string; company_id: string; lng: number; lat: number; address: string; neighbourhood: string | null; tech_park: string | null };
export type CityData = {
  companies: Company[];
  offices: Office[];
  neighbourhoods: Array<{ slug: string; name: string }>;
  techParks: Array<{ slug: string; name: string }>;
  jobs: Record<string, string[]>;
  synthetic: boolean;
  /** What only the company pages need (details.json). */
  details: { companies: Record<string, { description: string | null; website_url: string; careers_url: string | null }>; jobs: Job[] };
};

export type Job = { id: string; company_id: string; title: string; apply_url: string; status: "active" | "suspect"; last_checked_at: string | null };

/** The dataset the build wrote, read over HTTP like the browser does: the oracle the specs compare the page with. */
export async function loadCityData(request: APIRequestContext, city: string): Promise<CityData> {
  const manifest = (await (await request.get("/data/manifest.json")).json()) as Manifest;
  const entry = manifest.cities[city];
  const get = async (name: string) => (await request.get(entry.files[name].path)).json();
  const [companies, offices, search, details] = await Promise.all([get("companies"), get("offices"), get("search"), get("details")]);
  return {
    companies: companies.companies,
    offices: offices.offices,
    neighbourhoods: companies.neighbourhoods,
    techParks: companies.tech_parks,
    jobs: Object.fromEntries((search.entries as Array<{ company_id: string; jobs: string[] }>).map((e) => [e.company_id, e.jobs])),
    synthetic: entry.synthetic,
    details,
  };
}

/** Opens an explorer URL and waits until the dataset has arrived and (on the map view) the map has drawn. */
export async function openExplorer(page: Page, url: string, { map = true }: { map?: boolean } = {}) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await expect(page.getByTestId("explorer")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  if (map) {
    await expect(page.getByTestId("explorer-map")).toHaveAttribute("data-status", "ready", { timeout: 90_000 });
    await settle(page);
  }
  return errors;
}

/** Waits until nothing is moving and the layer has drawn at least one frame. */
export async function settle(page: Page) {
  await expect
    .poll(() => page.evaluate(() => !window.__explorer!.map.layer.stats.animating && window.__explorer!.map.layer.stats.drawn > 0), { timeout: 30_000 })
    .toBe(true);
}

/** Jumps the camera and waits for the new markers. */
export async function goTo(page: Page, lng: number, lat: number, zoom: number) {
  await page.evaluate(([lng, lat, zoom]) => window.__explorer!.map.map.jumpTo({ center: [lng, lat], zoom }), [lng, lat, zoom]);
  await settle(page);
  await page.waitForTimeout(400);
  await settle(page);
}

export const drawnNow = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Drawn[]>((resolve) => {
        const { map, layer } = window.__explorer!.map;
        map.once("render", () => resolve(layer.getDrawn()));
        map.triggerRepaint();
      }),
  );

/** The numbers the map was given, to compare with the list. */
export const mapCounts = (page: Page) => page.evaluate(() => window.__explorer!.map.loadedCounts());

/** Clicks where a marker is drawn. Coordinates are CSS px in the map. */
export async function clickMap(page: Page, x: number, y: number) {
  const box = (await page.getByTestId("explorer-map").boundingBox())!;
  await page.mouse.click(box.x + x, box.y + y);
}

/** The number in "38 companies in 41 offices". */
export async function shownCounts(page: Page): Promise<{ companies: number; offices: number }> {
  const text = (await page.getByTestId("result-count").textContent()) ?? "";
  const m = /(\d+) compan(?:y|ies) in (\d+) offices?/.exec(text);
  if (!m) throw new Error(`No counts in "${text}"`);
  return { companies: Number(m[1]), offices: Number(m[2]) };
}

// ---- an independent oracle ------------------------------------------------------------------------------------
// The specs compare the page with the dataset the build wrote, using this short re-statement of the rules in
// docs/filters.md, so a bug in lib/filters/filter.ts cannot hide behind itself.

export type Selection = { q?: string; types?: string[]; stages?: string[]; neighbourhoods?: string[]; techParks?: string[]; sectors?: string[] };

/** The slugs of the companies a filter should show. */
export function expectedSlugs(data: CityData, f: Selection): string[] {
  const hoodName = new Map(data.neighbourhoods.map((n) => [n.slug, n.name]));
  const parkName = new Map(data.techParks.map((t) => [t.slug, t.name]));
  const tokens = (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const types = f.types ?? [];
  // Stages count only while Startup is selected.
  const stages = types.includes("startup") ? (f.stages ?? []) : [];
  return data.companies
    .filter((c) => {
      const offices = data.offices.filter((o) => o.company_id === c.id);
      if (types.length > 0) {
        const ok = c.types.some((t) => types.includes(t) && (t !== "startup" || stages.length === 0 || (c.startup_stage !== null && stages.includes(c.startup_stage))));
        if (!ok) return false;
      }
      if (f.neighbourhoods?.length && !offices.some((o) => o.neighbourhood && f.neighbourhoods!.includes(o.neighbourhood))) return false;
      if (f.techParks?.length && !offices.some((o) => o.tech_park && f.techParks!.includes(o.tech_park))) return false;
      if (f.sectors?.length && !c.sectors.some((s) => f.sectors!.includes(s))) return false;
      const fields = [
        c.name,
        ...(data.jobs[c.id] ?? []),
        ...offices.flatMap((o) => [o.neighbourhood ? hoodName.get(o.neighbourhood)! : "", o.tech_park ? parkName.get(o.tech_park)! : "", o.address]),
      ].map((x) => x.toLowerCase());
      return tokens.every((t) => fields.some((field) => field.includes(t)));
    })
    .map((c) => c.slug)
    .sort();
}

export const officeCountFor = (data: CityData, slugs: string[]): number => {
  const ids = new Set(data.companies.filter((c) => slugs.includes(c.slug)).map((c) => c.id));
  return data.offices.filter((o) => ids.has(o.company_id)).length;
};

/** The slugs of the rows in the list or the grid, sorted. */
export const rowSlugs = async (page: Page): Promise<string[]> =>
  (await page.getByTestId("company-row").evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.company!))).sort();

/** Changes the URL the way the app does, so the page reacts without a reload. */
export const pushUrl = (page: Page, url: string) => page.evaluate((u) => window.history.pushState(null, "", u), url);
