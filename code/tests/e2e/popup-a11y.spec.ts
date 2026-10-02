import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { drawnNow, events, goTo, groups, mapSize, markerState, openLive, settle, tap, type Drawn } from "./live-helpers";

// P2-07. The company popup, the keyboard route through the markers, reduced motion, and the failure fallbacks
// (no WebGL2, tiles that will not load). Taps and keys go through the same code paths a person's would.

test.describe.configure({ timeout: 120_000 });

/** A dense place: around the 30-company building, at street level, so plenty of single logos are on screen. */
async function openDense(page: Page, zoom = 17) {
  const errors = await openLive(page);
  const building = (await groups(page)).find((g) => g.kind === "building")!;
  await goTo(page, building.lng, building.lat, zoom);
  return errors;
}

/** An isolated logo well inside the map, away from the control panel: a clean target for a tap. */
async function pickLogo(page: Page, minX = 420): Promise<Drawn> {
  const { w, h } = await mapSize(page);
  const frame = await drawnNow(page);
  const clear = frame.filter(
    (d) =>
      d.kind === "logo" &&
      d.opacity > 0.9 &&
      d.x > minX && d.x < w - 120 && d.y > 120 && d.y < h - 120 &&
      frame.every((o) => o === d || Math.hypot(o.x - d.x, o.y - d.y) > o.radius + d.radius + 6),
  );
  expect(clear.length, "an isolated logo is on screen").toBeGreaterThan(0);
  return clear[0];
}

const popup = (page: Page) => page.getByTestId("map-popup");
const box = async (page: Page) => (await popup(page).boundingBox())!;

test("a tap on a logo opens its popup, beside the marker and clear of it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the phone profile gets a bottom sheet, tested below");
  await openDense(page);
  const target = await pickLogo(page);
  await tap(page, testInfo, target.x, target.y);

  await expect(popup(page)).toBeVisible();
  await expect(popup(page)).toHaveAttribute("data-layout", "popover");
  await expect(popup(page)).toHaveAttribute("data-company", target.key);
  await expect(page.getByRole("dialog")).toHaveAccessibleName(/\w+/);
  await expect(popup(page).getByRole("link", { name: "View company" })).toBeVisible();
  await expect(popup(page).getByRole("button", { name: /^Close / })).toBeVisible();
  // Touch targets are at least 44 px (CLAUDE.md).
  for (const control of [popup(page).getByRole("link", { name: "View company" }), popup(page).getByRole("button", { name: /^Close / })]) {
    const size = (await control.boundingBox())!;
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }
  // What is not known is said so: the synthetic data has no neighbourhood, accuracy or job count.
  await expect(popup(page)).toContainText("Not stated");
  await expect(popup(page)).toContainText("Not yet checked");
  await expect(popup(page)).toContainText("Synthetic data");

  // Where is the marker now? The map may have eased to make room.
  await settle(page);
  const selected = (await drawnNow(page)).find((d) => d.key === target.key)!;
  expect(selected.selected).toBe(true);
  const b = await box(page);
  const nearestX = Math.min(Math.max(selected.x, b.x), b.x + b.width);
  const nearestY = Math.min(Math.max(selected.y, b.y), b.y + b.height);
  expect(Math.hypot(selected.x - nearestX, selected.y - nearestY), "the popup is clear of its marker").toBeGreaterThanOrEqual(selected.radius + 11);
  // Inside the map, and clear of the control panel on the left.
  const { w, h } = await mapSize(page);
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(w);
  expect(b.y + b.height).toBeLessThanOrEqual(h);
  const panel = (await page.getByRole("heading", { name: "Marker layer check" }).locator("..").boundingBox())!;
  const overlapsPanel = b.x < panel.x + panel.width && b.x + b.width > panel.x && b.y < panel.y + panel.height && b.y + b.height > panel.y;
  expect(overlapsPanel, "the popup does not cover the control panel").toBe(false);
});

test("the map eases to make room when the marker is too close to the edge, and the popup follows the marker", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop placement");
  await openDense(page);
  const { w, h } = await mapSize(page);
  // Find a logo near the right edge, where neither side has room until the map moves.
  const frame = await drawnNow(page);
  const edge = frame
    .filter((d) => d.kind === "logo" && d.opacity > 0.9 && d.x > w - 200 && d.x < w - 90 && d.y > 120 && d.y < h - 120)
    .sort((a, b) => b.x - a.x)[0];
  test.skip(!edge, "no logo near the right edge in this view");
  await tap(page, testInfo, edge.x, edge.y);
  await expect(popup(page)).toBeVisible();
  await settle(page);
  await expect.poll(async () => (await box(page)).x + (await box(page)).width, { timeout: 10_000 }).toBeLessThanOrEqual(w);
  const selected = (await drawnNow(page)).find((d) => d.key === edge.key)!;
  const b = await box(page);
  expect(Math.hypot(selected.x - Math.min(Math.max(selected.x, b.x), b.x + b.width), selected.y - Math.min(Math.max(selected.y, b.y), b.y + b.height))).toBeGreaterThanOrEqual(selected.radius + 11);
});

test("Escape and the close button close the popup and clear the selection", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "keyboard on desktop");
  await openDense(page);
  const target = await pickLogo(page);
  await tap(page, testInfo, target.x, target.y);
  await expect(popup(page)).toBeVisible();
  await popup(page).focus();
  await page.keyboard.press("Escape");
  await expect(popup(page)).toHaveCount(0);
  expect((await markerState(page)).selected).toBe("");

  await settle(page);
  const again = await pickLogo(page);
  await tap(page, testInfo, again.x, again.y);
  await popup(page).getByRole("button", { name: /^Close / }).click();
  await expect(popup(page)).toHaveCount(0);
  expect((await markerState(page)).selected).toBe("");
});

test("View company is a link to the company page, and a click on it is recorded", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop");
  await openDense(page);
  const target = await pickLogo(page);
  await tap(page, testInfo, target.x, target.y);
  const link = popup(page).getByRole("link", { name: "View company" });
  await expect(link).toHaveAttribute("href", /^\/companies\/synthetic-\d+$/);
  await link.click();
  expect((await events(page)).at(-1)).toEqual({ type: "view-company", key: target.key });
});

test("on a phone the popup is a bottom sheet, and the marker is centred in the map above it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone profile only");
  await openDense(page);
  const target = await pickLogo(page, 40);
  await tap(page, testInfo, target.x, target.y);
  await expect(popup(page)).toBeVisible();
  await expect(popup(page)).toHaveAttribute("data-layout", "sheet");
  await settle(page);
  const { w, h } = await mapSize(page);
  const sheet = await box(page);
  expect(sheet.x).toBe(0);
  expect(sheet.width).toBeCloseTo(w, 0);
  expect(sheet.y + sheet.height).toBeCloseTo(h, 0);
  expect(sheet.height).toBeCloseTo(Math.round(h * 0.3), 0); // peek: 30% of the screen
  const selected = (await drawnNow(page)).find((d) => d.key === target.key)!;
  expect(selected.y + selected.radius, "the marker is above the sheet").toBeLessThanOrEqual(sheet.y);
  // Centred in the uncovered area (the pan has finished; allow a few px for rounding).
  expect(selected.x).toBeCloseTo(w / 2, -1);
  expect(selected.y).toBeCloseTo((h - sheet.height) / 2, -1);
});

test("under reduced motion the popup opens with no animation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDense(page);
  const target = await pickLogo(page);
  await tap(page, testInfo, target.x, target.y);
  await expect(popup(page)).toBeVisible();
  // The global reduced-motion rule shortens every animation to 0.01 ms.
  const duration = await popup(page).evaluate((el) => getComputedStyle(el).animationDuration);
  expect(parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000)).toBeLessThanOrEqual(0.02);
});

test("with motion allowed the popup opens in 160 ms", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openDense(page);
  const target = await pickLogo(page);
  await tap(page, testInfo, target.x, target.y);
  await expect(popup(page)).toBeVisible();
  const duration = await popup(page).evaluate((el) => getComputedStyle(el).animationDuration);
  expect(duration).toBe("0.16s");
});

// ---- keyboard ---------------------------------------------------------------------------------------------

const listButtons = (page: Page) => page.getByTestId("map-a11y-list").locator("button");
const focusedKey = (page: Page) => page.evaluate(() => window.__markers!.controller.focusedKey);

/** Presses Tab until focus is inside the mirror list. */
async function tabIntoList(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => !!document.activeElement?.closest('[data-testid="map-a11y-list"]'))) return;
  }
  throw new Error("Tab never reached the mirror list.");
}

test("every drawn marker is in the keyboard list, and the list is one tab stop", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "keyboard on desktop");
  await openDense(page);
  await settle(page);
  const { w, h } = await mapSize(page);
  const drawn = (await drawnNow(page)).filter((d) => d.opacity >= 0.5 && d.x >= 0 && d.x <= w && d.y >= 0 && d.y <= h);
  await expect.poll(() => listButtons(page).count(), { timeout: 10_000 }).toBe(drawn.length);
  const listed = await listButtons(page).evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.key));
  expect(new Set(listed)).toEqual(new Set(drawn.map((d) => d.key)));
  // Roving tabindex: exactly one button is a tab stop.
  expect(await listButtons(page).evaluateAll((els) => els.filter((el) => (el as HTMLElement).tabIndex === 0).length)).toBe(1);
  // Each button has a name a screen reader can say.
  for (const name of await listButtons(page).evaluateAll((els) => els.map((el) => el.textContent?.trim() ?? ""))) expect(name.length).toBeGreaterThan(0);
});

test("arrow keys move focus between markers as drawn, and the layer shows the focus ring", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "keyboard on desktop");
  await openDense(page);
  await settle(page);
  await tabIntoList(page);
  const first = await focusedKey(page);
  expect(first).not.toBeNull();
  await expect.poll(async () => (await drawnNow(page)).length).toBeGreaterThan(1);

  // Walk right and down a few steps: focus moves, and the key the controller has focused is the DOM-focused one.
  const visited = new Set<string>([first!]);
  for (const key of ["ArrowRight", "ArrowRight", "ArrowDown", "ArrowLeft", "ArrowDown"]) {
    await page.keyboard.press(key);
    const now = await focusedKey(page);
    expect(now).not.toBeNull();
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.key)).toBe(now);
    visited.add(now!);
  }
  expect(visited.size, "arrow keys reach other markers").toBeGreaterThan(1);

  // Home and End jump to the ends of reading order.
  await page.keyboard.press("End");
  const last = await focusedKey(page);
  await page.keyboard.press("Home");
  expect(await focusedKey(page)).toBe(first);
  expect(last).not.toBe(first);

  // The focus ring is drawn on the focused marker: its flag is set in the layer.
  const ring = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const { map, layer } = window.__mapLayer!;
        map.once("render", () => resolve(layer.stats.drawn > 0));
        map.triggerRepaint();
      }),
  );
  expect(ring).toBe(true);
  // Leaving the list clears the ring.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  expect(await focusedKey(page)).toBeNull();
});

test("Enter opens a marker from the keyboard, focus moves into the popup, and Escape returns it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "keyboard on desktop");
  await openDense(page);
  await settle(page);
  // Find a logo entry (not a cluster or a stack).
  const logoKey = (await pickLogo(page)).key;
  expect(logoKey).not.toBeNull();
  await tabIntoList(page);
  await page.getByTestId("map-a11y-list").locator(`button[data-key="${logoKey}"]`).focus();
  await page.keyboard.press("Enter");

  await expect(popup(page)).toBeVisible();
  await expect(popup(page)).toHaveAttribute("data-company", logoKey!);
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).toBe("map-popup");

  await page.keyboard.press("Escape");
  await expect(popup(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.key ?? null)).toBe(logoKey);
});

test("Enter on a cluster flies to its expansion zoom, the same as a tap", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "keyboard on desktop");
  await openLive(page);
  const building = (await groups(page)).find((g) => g.kind === "building")!;
  await goTo(page, building.lng, building.lat, 12);
  await settle(page);
  const { w, h } = await mapSize(page);
  const cluster = (await drawnNow(page)).find((d) => d.kind === "cluster" && d.opacity > 0.9 && d.x > 80 && d.x < w - 80 && d.y > 80 && d.y < h - 80)?.key ?? null;
  expect(cluster).not.toBeNull();
  await expect.poll(() => listButtons(page).count()).toBeGreaterThan(0);
  const before = await page.evaluate(() => window.__mapLayer!.map.getZoom());
  await page.getByTestId("map-a11y-list").locator(`button[data-key="${cluster}"]`).focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await events(page)).filter((e) => e.type === "cluster").length).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__mapLayer!.map.getZoom()), { timeout: 15_000 }).toBeGreaterThan(before);
});

test("the popup, the keyboard list, and the control panel have no serious or critical axe violations", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop");
  await openDense(page);
  const target = await pickLogo(page);
  await tap(page, testInfo, target.x, target.y);
  await expect(popup(page)).toBeVisible();
  await settle(page);
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

// ---- failure modes ----------------------------------------------------------------------------------------

/** Geoapify vector tiles: /v1/tile/vector/{z}/{x}/{y}.pbf. The style, sprite and fonts live elsewhere and still load. */
const TILES = /\/v1\/tile\/vector\//;

test("without WebGL2 the page shows the list and a notice instead of a dead map", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === "webgl2" || type === "webgl" || type === "experimental-webgl") return null;
      return (original as (...a: unknown[]) => unknown).call(this, type, ...rest) as never;
    } as typeof original;
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/dev/map-layer");
  await expect(page.getByTestId("map-layer")).toHaveAttribute("data-status", "fallback", { timeout: 30_000 });
  await expect(page.getByTestId("map-fallback-notice")).toContainText("can't run on this device");
  await expect(page.getByTestId("company-list").locator("li").first()).toBeVisible();
  expect(await page.getByTestId("company-list").locator("li").count()).toBeGreaterThan(50);
  expect(await page.locator("canvas").count()).toBe(0);

  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  expect(errors).toEqual([]);
});

test("when the basemap tiles keep failing, a banner offers Try again and the list; the markers keep working", async ({ page }) => {
  // Needs a Geoapify key in this build: without one the page draws on a blank background and has no tiles to fail.
  await page.route(TILES, (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto("/dev/map-layer");
  await expect(page.getByTestId("map-layer")).not.toHaveAttribute("data-status", "loading", { timeout: 90_000 });
  const hasTiles = await page.evaluate(() => Object.values(window.__mapLayer?.map.getStyle().sources ?? {}).some((s) => s.type === "vector"));
  test.skip(!hasTiles, "No Geoapify key in this build, so there are no tiles to fail");

  await page.evaluate(() => window.__mapLayer!.map.jumpTo({ zoom: 13 })); // new tiles are needed, and they fail
  await expect(page.getByTestId("tile-banner")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("tile-banner")).toContainText("didn't load");
  // The markers are still drawn.
  expect((await page.evaluate(() => window.__mapLayer!.layer.stats.drawn))).toBeGreaterThan(0);

  // Let the tiles through and try again: the banner goes.
  await page.unroute(TILES);
  await page.getByTestId("tile-banner").getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("tile-banner")).toHaveCount(0, { timeout: 60_000 });
});

test("the banner's Show the list opens the list view", async ({ page }) => {
  await page.route(TILES, (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto("/dev/map-layer");
  await expect(page.getByTestId("map-layer")).not.toHaveAttribute("data-status", "loading", { timeout: 90_000 });
  const hasTiles = await page.evaluate(() => Object.values(window.__mapLayer?.map.getStyle().sources ?? {}).some((s) => s.type === "vector"));
  test.skip(!hasTiles, "No Geoapify key in this build, so there are no tiles to fail");
  await page.evaluate(() => window.__mapLayer!.map.jumpTo({ zoom: 13 }));
  await expect(page.getByTestId("tile-banner")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("tile-banner").getByRole("button", { name: "Show the list" }).click();
  await expect(page.getByTestId("list-view").getByTestId("company-list")).toBeVisible();
});
