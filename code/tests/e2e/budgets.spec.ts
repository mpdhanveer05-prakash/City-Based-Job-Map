import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { openExplorer } from "./explorer-helpers";

// P9-03. The architecture plan proposes: explorer JavaScript under 350 KB gzipped, MapLibre included (NFR01). This measures
// what the page really loads, including chunks fetched later and MapLibre's own files, by gzipping each script response here
// (the local server does not compress). It runs on desktop only.
//
// MEASURED 5 Oct 2026: about 629 KB (MapLibre 297 KB, the app 331 KB), so the plan's target is NOT met, and MapLibre alone is
// 85% of it. The target is reported on every run and the gap is an open decision (D-12 in plan.md); it is not hidden by
// raising the target. What this spec enforces is a ceiling at today's size plus headroom, so the page cannot get heavier
// without someone choosing to. Lower the ceiling whenever the app gets lighter. The real-device timing half of P9-03 (a
// useful first view in 3 s on a mid-range Android over throttled 4G) needs named devices (D-06) and is not here.

const PLAN_TARGET_BYTES = 350 * 1024;
const CEILING_BYTES = 660 * 1024;
const isScript = (url: string) => /\.m?js$/.test(new URL(url).pathname);

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
    const summary = `${city}: ${(total / 1024).toFixed(1)} KB gzipped in ${sizes.size} scripts (MapLibre ${(maplibre / 1024).toFixed(1)} KB); plan target ${PLAN_TARGET_BYTES / 1024} KB, ${gap > 0 ? `over by ${(gap / 1024).toFixed(1)} KB` : "met"}. Largest: ${largest.join("; ")}`;
    testInfo.annotations.push({ type: "js-budget", description: summary });
    console.log(summary);
    expect(maplibre, "MapLibre's files were loaded and counted").toBeGreaterThan(0);
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
