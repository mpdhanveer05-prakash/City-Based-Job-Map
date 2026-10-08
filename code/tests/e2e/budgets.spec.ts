import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { openExplorer } from "./explorer-helpers";

// P9-03 and P9-12. What each page really loads, gzipped here (the local server does not compress), on desktop only.
//
// Explorer (D-12, ADR-0020, provisional): a target of 650 KB gzipped, MapLibre included. The architecture plan's 350 KB
// (NFR01) is still reported on every run; it is not met, because MapLibre alone is about 297 KB. The spec fails above a
// ceiling at today's size plus headroom, which is below the target, so the page cannot get heavier without someone choosing
// to. Lower the ceiling whenever the app gets lighter; never raise it above the target.
//   5 Oct 2026: 629 KB (MapLibre 297, app 332). 8 Oct 2026, after P9-12: 566 KB (MapLibre 297, app 269). The cuts: the
//   explorer's schemas use `zod/mini` (the full `zod` entry brought every locale and the JSON-schema code), and TanStack
//   Query's provider moved from the public layout to the city page.
//
// City selection (ADR-0020: "its own small budget"; 150 KB is a proposal): the scripts its HTML loads to render and hydrate,
// not the explorer code Next prefetches afterwards for the city links (that is reported, not limited). 8 Oct 2026: 134 KB,
// which is the framework (React, the Next runtime); the page itself ships no other client code.
//
// The real-device timing half of P9-03 (a useful first view in 3 s on a mid-range Android over throttled 4G) needs named
// devices (D-06) and is not here.

const PLAN_TARGET_BYTES = 350 * 1024;
const TARGET_BYTES = 650 * 1024;
const CEILING_BYTES = 600 * 1024;
const HOME_BUDGET_BYTES = 150 * 1024;
const isScript = (url: string) => /\.m?js$/.test(new URL(url).pathname);
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

test.skip(({ isMobile }) => isMobile, "The budget is measured once, on desktop");

for (const city of ["bangalore", "chennai"]) {
  test(`${city}: the explorer loads stays under its JavaScript ceiling (gzipped, MapLibre included)`, async ({ page }, testInfo) => {
    const sizes = new Map<string, number>();
    page.on("response", async (response) => {
      const url = response.url();
      if (!isScript(url) || !response.ok()) return;
      const body = await response.body().catch(() => null);
      if (body) sizes.set(new URL(url).pathname, gzipSync(body).length);
    });
    await openExplorer(page, `/${city}`);
    await page.waitForLoadState("networkidle");

    const total = [...sizes.values()].reduce((a, b) => a + b, 0);
    const largest = [...sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p, n]) => `${(n / 1024).toFixed(1)} KB ${p}`);
    const maplibre = [...sizes.entries()].filter(([p]) => p.startsWith("/maplibre/")).reduce((a, [, n]) => a + n, 0);
    const gap = total - PLAN_TARGET_BYTES;
    const summary = `${city}: ${(total / 1024).toFixed(1)} KB gzipped in ${sizes.size} scripts (MapLibre ${(maplibre / 1024).toFixed(1)} KB); target ${TARGET_BYTES / 1024} KB (ceiling ${CEILING_BYTES / 1024} KB); plan target ${PLAN_TARGET_BYTES / 1024} KB, ${gap > 0 ? `over by ${(gap / 1024).toFixed(1)} KB` : "met"}. Largest: ${largest.join("; ")}`;
    testInfo.annotations.push({ type: "js-budget", description: summary });
    console.log(summary);
    expect(maplibre, "MapLibre's files were loaded and counted").toBeGreaterThan(0);
    expect(CEILING_BYTES, "the ceiling is never above the D-12 target").toBeLessThanOrEqual(TARGET_BYTES);
    expect(total, summary).toBeLessThan(CEILING_BYTES);
  });

  test(`${city}: the city dataset is small enough to download and is not larger than the manifest says`, async ({ request }, testInfo) => {
    const manifest = (await (await request.get("/data/manifest.json")).json()) as {
      cities: Record<string, { files: Record<string, { path: string; bytes?: number }> }>;
    };
    const entry = manifest.cities[city];
    expect(entry, `${city} is in the manifest`).toBeTruthy();
    let raw = 0;
    let gz = 0;
    for (const file of Object.values(entry.files)) {
      const body = await (await request.get(file.path)).body();
      raw += body.length;
      gz += gzipSync(body).length;
    }
    // Reported, not limited: the docs set no dataset budget yet (the seed is a small sample). Revisit with real data.
    const summary = `${city} dataset: ${(raw / 1024).toFixed(1)} KB raw, ${(gz / 1024).toFixed(1)} KB gzipped, ${Object.keys(entry.files).length} files`;
    testInfo.annotations.push({ type: "dataset-size", description: summary });
    console.log(summary);
    expect(raw).toBeGreaterThan(0);
  });
}

test("the city-selection page stays under its own JavaScript budget (gzipped)", async ({ page, request }, testInfo) => {
  // What the HTML loads: every script tag but the `nomodule` polyfill, which a current browser never fetches.
  const html = await (await request.get("/")).text();
  const tags = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  const sources = [
    ...new Set(tags.filter((t) => !/\bnomodule\b/i.test(t)).map((t) => /\bsrc="([^"]+\.m?js)"/.exec(t)?.[1]).filter((x): x is string => !!x)),
  ];
  let initial = 0;
  for (const src of sources) initial += gzipSync(await (await request.get(src)).body()).length;

  // Everything the browser fetches by network idle, including the explorer code Next prefetches for the city links.
  const fetched = new Map<string, number>();
  page.on("response", async (response) => {
    if (!isScript(response.url()) || !response.ok()) return;
    const body = await response.body().catch(() => null);
    if (body) fetched.set(new URL(response.url()).pathname, gzipSync(body).length);
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const withPrefetch = [...fetched.values()].reduce((a, b) => a + b, 0);

  const summary = `city selection: ${kb(initial)} gzipped in the ${sources.length} scripts its HTML loads (budget ${kb(HOME_BUDGET_BYTES)}); ${kb(withPrefetch)} with the explorer code prefetched after load`;
  testInfo.annotations.push({ type: "js-budget", description: summary });
  console.log(summary);
  expect(sources.length, "the page loads its scripts").toBeGreaterThan(0);
  expect(initial, summary).toBeLessThan(HOME_BUDGET_BYTES);
  // No MapLibre, and no explorer-only libraries, before a city is chosen.
  expect([...fetched.keys()].some((p) => p.startsWith("/maplibre/")), "MapLibre is not loaded on the city-selection page").toBe(false);
});
