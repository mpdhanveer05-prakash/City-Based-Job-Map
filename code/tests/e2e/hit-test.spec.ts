import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { drawnNow, events, goTo, groups, mapSize, markerState, nearestTo, openLive, settle, tap, updates, type Group } from "./live-helpers";

// P2-06. Taps and clicks on the live scenario: what a tap selects while markers move, how stacks open into a
// circle, a spiral, or the list, how a cluster flies to its expansion zoom, and what closes a spider. The
// markers' positions are read from the layer's own last frame (the debug hook), so a tap lands exactly where a
// marker was drawn.

test.describe.configure({ timeout: 120_000 });

/** Opens the stack at a co-location group (centred on screen) with a tap, and returns the drawn markers. */
async function openStackAt(page: Page, testInfo: TestInfo, group: Group) {
  await goTo(page, group.lng, group.lat, 19);
  const { w, h } = await mapSize(page);
  const stacks = (await drawnNow(page)).filter((d) => d.kind === "stack");
  expect(stacks.length, `${group.id}: a stack is drawn at zoom 19`).toBeGreaterThan(0);
  const stack = nearestTo(stacks, w / 2, h / 2);
  expect(Math.hypot(stack.x - w / 2, stack.y - h / 2), `${group.id}: the stack sits at the group's location`).toBeLessThan(25);
  await tap(page, testInfo, stack.x, stack.y);
  return { stack, w, h };
}

/** One group, end to end: tap the stack, check the layout, select a member, close it with Escape. */
async function checkGroup(page: Page, testInfo: TestInfo, group: Group) {
  const { stack } = await openStackAt(page, testInfo, group);
  const expectedMode = group.size <= 8 ? "circle" : group.size <= 20 ? "spiral" : "list";
  await expect.poll(async () => (await markerState(page)).spider, { timeout: 15_000, message: group.id }).toBe(expectedMode);
  await settle(page);

  // Other offices may be on screen too: look only at this group's members.
  const memberKeys = new Set(await page.evaluate(() => window.__markers!.controller.spider!.memberKeys));
  expect(memberKeys.size, `${group.id}: every company is a member`).toBe(group.size);
  const drawn = await drawnNow(page);
  const members = drawn.filter((d) => d.kind === "logo" && memberKeys.has(d.key));
  if (expectedMode === "list") {
    expect(members, `${group.id}: the list draws no spider`).toHaveLength(0);
    await expect(page.getByTestId("stack-list").locator("li")).toHaveCount(group.size);
  } else {
    expect(members, `${group.id}: one logo per company`).toHaveLength(group.size);
    expect(new Set(members.map((m) => m.key)).size).toBe(group.size);
    // No two members overlap, and none sits on the stack.
    for (const [i, a] of members.entries()) {
      expect(Math.hypot(a.x - stack.x, a.y - stack.y), `${group.id}: member clear of the stack`).toBeGreaterThan(a.radius + stack.radius - 1);
      for (const b of members.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y), `${group.id}: members overlap`).toBeGreaterThan(a.radius + b.radius);
    }
    // A tap on a member selects it.
    const target = members[members.length - 1];
    await tap(page, testInfo, target.x, target.y);
    await expect.poll(async () => (await markerState(page)).selected, { timeout: 10_000 }).toBe(target.key);
    await settle(page);
    const after = (await drawnNow(page)).find((d) => d.key === target.key)!;
    expect(after.selected).toBe(true);
    expect(after.radius).toBeCloseTo(target.radius * 1.25, 0);
  }

  await page.keyboard.press("Escape");
  await expect.poll(async () => (await markerState(page)).spider, { timeout: 10_000 }).toBe("");
  await page.evaluate(() => window.__markers!.controller.setSelected(null));
}

test("every co-location group opens as a circle, a spiral, or the list, and Escape closes it", async ({ page }, testInfo) => {
  test.setTimeout(testInfo.project.name === "mobile" ? 300_000 : 600_000);
  const errors = await openLive(page);
  const all = await groups(page);
  expect(all).toHaveLength(61); // 50 identical, 10 near, 1 building
  // The phone profile draws in software at 2.6x, so it takes one group of each rule boundary; the desktop takes all.
  const chosen =
    testInfo.project.name === "mobile"
      ? [2, 8, 9, 20, 21, 30].map((size) => all.find((g) => g.size === size)).filter((g): g is Group => !!g)
      : all;
  expect(chosen.length).toBeGreaterThan(0);
  for (const group of chosen) await checkGroup(page, testInfo, group);
  expect(errors).toEqual([]);
});

test("the stack shows the number of companies, and its spider draws a leg to each member", async ({ page }, testInfo) => {
  await openLive(page);
  const group = (await groups(page)).find((g) => g.kind === "identical" && g.size >= 3 && g.size <= 8)!;
  await openStackAt(page, testInfo, group);
  await expect.poll(async () => (await markerState(page)).spider).toBe("circle");
  await settle(page);
  const legs = await page.evaluate(() => {
    const { map } = window.__mapLayer!;
    const source = map.getSource("company-markers-spider-legs") as unknown as { serialize(): { data: GeoJSON.FeatureCollection<GeoJSON.LineString> } } | undefined;
    return {
      layerExists: !!map.getLayer("company-markers-spider-legs"),
      features: source?.serialize().data.features.length ?? 0,
      spider: window.__markers!.controller.spider?.legs.length ?? 0,
    };
  });
  expect(legs).toEqual({ layerExists: true, features: group.size, spider: group.size });
});

test("a tap on the map, a zoom, and Escape each close an open spider", async ({ page }, testInfo) => {
  await openLive(page);
  const group = (await groups(page)).find((g) => g.kind === "identical" && g.size >= 3 && g.size <= 8)!;

  await openStackAt(page, testInfo, group);
  await expect.poll(async () => (await markerState(page)).spider).toBe("circle");
  await settle(page);
  const { w, h } = await mapSize(page);
  await tap(page, testInfo, 12, h - 12); // empty map, a corner
  await expect.poll(async () => (await markerState(page)).spider).toBe("");
  expect((await events(page)).at(-1)).toEqual({ type: "background" });

  await openStackAt(page, testInfo, group);
  await expect.poll(async () => (await markerState(page)).spider).toBe("circle");
  await page.evaluate(() => window.__mapLayer!.map.jumpTo({ zoom: 18.2 }));
  await expect.poll(async () => (await markerState(page)).spider).toBe("");

  // Opening the same stack again, then tapping its stack once more, closes it.
  await goTo(page, group.lng, group.lat, 19);
  const stack = nearestTo((await drawnNow(page)).filter((d) => d.kind === "stack"), w / 2, h / 2);
  await tap(page, testInfo, stack.x, stack.y);
  await expect.poll(async () => (await markerState(page)).spider).toBe("circle");
  await settle(page);
  await tap(page, testInfo, stack.x, stack.y);
  await expect.poll(async () => (await markerState(page)).spider).toBe("");
});

test("a tap during a split selects the marker drawn under the finger, scanned linearly at its animated position", async ({ page }, testInfo) => {
  await openLive(page);
  const building = (await groups(page)).find((g) => g.kind === "building")!;
  await goTo(page, building.lng, building.lat, 15);

  // Hold the layer's clock, so a split stays at exactly half way while the tap happens.
  await page.evaluate(() => {
    let t = performance.now();
    window.__layerNow = () => t;
    (window as unknown as { __advance: (ms: number) => void }).__advance = (ms) => { t += ms; };
  });
  const before = await updates(page);
  await page.evaluate(() => window.__mapLayer!.map.jumpTo({ zoom: 16 }));
  await expect.poll(() => updates(page), { timeout: 30_000 }).toBeGreaterThan(before);
  await page.evaluate(() => (window as unknown as { __advance: (ms: number) => void }).__advance(140));
  const frame = await drawnNow(page);
  expect(await page.evaluate(() => window.__mapLayer!.layer.stats.animating)).toBe(true);

  // A logo that is mostly visible, fully inside the map, and clear of every other marker, so "under the finger" is unambiguous.
  const { w, h } = await mapSize(page);
  const clear = frame.filter(
    (d) =>
      d.kind === "logo" &&
      d.opacity >= 0.5 &&
      d.x > 60 && d.x < w - 60 && d.y > 60 && d.y < h - 60 &&
      frame.every((o) => o === d || Math.hypot(o.x - d.x, o.y - d.y) > o.radius + d.radius + 4),
  );
  expect(clear.length, "an isolated, visible logo exists mid-split").toBeGreaterThan(0);
  const target = clear[0];

  await tap(page, testInfo, target.x, target.y);
  await expect.poll(async () => (await events(page)).filter((e) => e.type === "logo").length, { timeout: 10_000 }).toBe(1);
  expect((await events(page)).at(-1)).toEqual({ type: "logo", key: target.key });
  expect(await page.evaluate(() => window.__markers!.interactions.tester.lastMethod)).toBe("linear");
  expect(await page.evaluate(() => window.__mapLayer!.layer.stats.animating)).toBe(true); // it really was mid-animation

  // Release the clock. Nothing asks for a frame while it is held, so ask for one to let the transition finish.
  await page.evaluate(() => {
    delete window.__layerNow;
    window.__mapLayer!.map.triggerRepaint();
  });
  await settle(page);
  expect((await markerState(page)).selected).toBe(target.key);
});

test("once settled, a tap is answered by the index, which is built once per frame", async ({ page }, testInfo) => {
  await openLive(page);
  const building = (await groups(page)).find((g) => g.kind === "building")!;
  await goTo(page, building.lng, building.lat, 17);
  const frame = await drawnNow(page);
  const marker = frame.find((d) => d.kind === "logo" || d.kind === "cluster")!;
  // All in one task, so no new frame can be drawn in between: 21 queries, one build.
  const result = await page.evaluate(([x, y]) => {
    const { interactions } = window.__markers!;
    const before = interactions.tester.builds;
    const first = interactions.hitTest(x, y, "mouse")?.key ?? null;
    const method = interactions.tester.lastMethod;
    for (let i = 0; i < 20; i++) interactions.hitTest(x + (i % 3), y, "mouse");
    return { first, method, builds: interactions.tester.builds - before };
  }, [marker.x, marker.y]);
  expect(typeof result.first).toBe("string");
  expect(result.method).toBe("index");
  expect(result.builds).toBeLessThanOrEqual(1);
  expect(testInfo.project.name.length).toBeGreaterThan(0);
});

test("a tap on a cluster flies to the zoom at which it splits", async ({ page }, testInfo) => {
  await openLive(page);
  const building = (await groups(page)).find((g) => g.kind === "building")!;
  await goTo(page, building.lng, building.lat, 12);
  const { w, h } = await mapSize(page);
  const clusters = (await drawnNow(page)).filter((d) => d.kind === "cluster" && d.x > 80 && d.x < w - 80 && d.y > 80 && d.y < h - 80);
  expect(clusters.length).toBeGreaterThan(0);
  const target = clusters.reduce((a, b) => (b.radius > a.radius ? b : a));
  await tap(page, testInfo, target.x, target.y);

  await expect.poll(async () => (await events(page)).filter((e) => e.type === "cluster").length, { timeout: 15_000 }).toBe(1);
  const event = (await events(page)).find((e) => e.type === "cluster")!;
  expect(event.key).toBe(target.key);
  expect(event.zoom).toBeGreaterThan(12);
  await expect.poll(() => page.evaluate(() => window.__mapLayer!.map.getZoom()), { timeout: 15_000 }).toBeCloseTo(Math.min(event.zoom!, 19), 3);
  await settle(page);
  expect((await drawnNow(page)).map((d) => d.key), "the tapped cluster has split").not.toContain(target.key);
});
