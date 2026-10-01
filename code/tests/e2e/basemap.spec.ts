import { expect, test, type Page } from "@playwright/test";

// P1-05. Needs NEXT_PUBLIC_GEOAPIFY_KEY at build time (code/.env.local) and network access to
// Geoapify, so it skips itself where the key is absent (CI has none).

async function openBasemap(page: Page) {
  await page.goto("/dev/basemap");
  const map = page.getByTestId("basemap");
  await expect(map).not.toHaveAttribute("data-status", "loading", { timeout: 30_000 });
  const status = await map.getAttribute("data-status");
  test.skip(
    (await page.getByText("NEXT_PUBLIC_GEOAPIFY_KEY is not set.").count()) > 0,
    "No Geoapify key in this build",
  );
  expect(status).toBe("ready");
}

test("shows Geoapify, OpenMapTiles and OpenStreetMap attribution without a click", async ({ page }) => {
  await openBasemap(page);
  const attribution = page.locator(".maplibregl-ctrl-attrib");
  await expect(attribution).toBeVisible();
  await expect(attribution.getByRole("link", { name: "Geoapify" })).toBeVisible();
  await expect(attribution.getByRole("link", { name: /OpenStreetMap/ })).toBeVisible();
  await expect(attribution.getByRole("link", { name: /OpenMapTiles/ })).toBeVisible();
});

test("fills the whole viewport", async ({ page }) => {
  await openBasemap(page);
  const viewport = page.viewportSize()!;
  const box = (await page.locator("canvas.maplibregl-canvas").boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(viewport.width - 1);
  expect(box.height).toBeGreaterThanOrEqual(viewport.height - 1);
});

test("renders Milky land and no green anywhere on the basemap", async ({ page }) => {
  await openBasemap(page);
  // Read the WebGL canvas in the same task as a render, so the drawing buffer is still valid.
  const result = await page.evaluate(
    () =>
      new Promise<{ landShare: number; greenPixels: number; total: number }>((resolve) => {
        const map = window.__basemap!.map;
        map.once("render", () => {
          const source = map.getCanvas();
          const copy = document.createElement("canvas");
          copy.width = source.width;
          copy.height = source.height;
          const ctx = copy.getContext("2d")!;
          ctx.drawImage(source, 0, 0);
          const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
          let land = 0;
          let green = 0;
          const total = data.length / 4;
          for (let i = 0; i < data.length; i += 4) {
            const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
            if (r === 255 && g === 253 && b === 241) land += 1;
            // Green dominates both other channels. Milky (255,253,241) and the stone park never do.
            if (g > r + 12 && g > b + 12) green += 1;
          }
          resolve({ landShare: land / total, greenPixels: green, total });
        });
        map.triggerRepaint();
      }),
  );
  expect(result.greenPixels).toBe(0);
  expect(result.landShare).toBeGreaterThan(0.2);
});

test("every style layer colour comes from the design tokens", async ({ page }) => {
  await openBasemap(page);
  const offPalette = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const tokens = ["--milky", "--map-park", "--map-water", "--milky-shade", "--rule", "--map-road", "--moss"].map((t) =>
      css.getPropertyValue(t).trim().toLowerCase(),
    );
    const found: string[] = [];
    for (const layer of window.__basemap!.map.getStyle().layers) {
      const paint = ("paint" in layer ? layer.paint : undefined) ?? {};
      for (const [key, value] of Object.entries(paint)) {
        if (key.endsWith("-color") && !tokens.includes(String(value).toLowerCase())) found.push(`${layer.id}.${key}`);
      }
    }
    return found;
  });
  expect(offPalette).toEqual([]);
});

test("switches between both launch cities without request failures", async ({ page }) => {
  const failed: string[] = [];
  page.on("response", (r) => {
    if (r.url().startsWith("https://maps.geoapify.com/") && r.status() >= 400) failed.push(String(r.status()));
  });
  await openBasemap(page);
  await page.getByRole("button", { name: "Chennai" }).click();
  await page.evaluate(() => new Promise<void>((resolve) => window.__basemap!.map.once("idle", () => resolve())));
  expect(failed).toEqual([]);
});
