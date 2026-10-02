import { describe, expect, it } from "vitest";
import { latToMercatorY, lngToMercatorX, screenX, screenY, viewFor, LOGO_DIAMETER } from "@/map/layer/geometry";
import { CIRCLE_MAX, SPIDER_SPACING, SPIRAL_MAX, layoutSpider, legsGeoJson, openSpider, spiderMode, type SpiderMember } from "@/map/layer/spider";

const dist = (a: { dx: number; dy: number }, b: { dx: number; dy: number }) => Math.hypot(a.dx - b.dx, a.dy - b.dy);

function minPairDistance(offsets: Array<{ dx: number; dy: number }>): number {
  let min = Infinity;
  for (let i = 0; i < offsets.length; i++) for (let j = i + 1; j < offsets.length; j++) min = Math.min(min, dist(offsets[i], offsets[j]));
  return min;
}

describe("which layout a stack gets (map-spec §7)", () => {
  it("2 to 8 are a circle, 9 to 20 a spiral, more than 20 the list", () => {
    expect(CIRCLE_MAX).toBe(8);
    expect(SPIRAL_MAX).toBe(20);
    for (const n of [2, 3, 7, 8]) expect(spiderMode(n)).toBe("circle");
    for (const n of [9, 10, 19, 20]) expect(spiderMode(n)).toBe("spiral");
    for (const n of [21, 22, 25, 300]) expect(spiderMode(n)).toBe("list");
  });

  it("refuses a count that is not a stack", () => {
    for (const n of [0, 1, -3, 2.5, Number.NaN]) expect(() => spiderMode(n)).toThrow(RangeError);
  });
});

describe("circle", () => {
  it("puts every marker at one radius around the stack, the first straight up", () => {
    for (let n = 2; n <= CIRCLE_MAX; n++) {
      const { mode, offsets } = layoutSpider(n);
      expect(mode).toBe("circle");
      expect(offsets).toHaveLength(n);
      const radii = offsets.map((o) => Math.hypot(o.dx, o.dy));
      for (const r of radii) expect(r).toBeCloseTo(radii[0], 9);
      expect(offsets[0].dx).toBeCloseTo(0, 9);
      expect(offsets[0].dy).toBeLessThan(0); // up is negative y
    }
  });

  it("keeps neighbours a full spacing apart and clear of the stack's own marker", () => {
    for (let n = 2; n <= CIRCLE_MAX; n++) {
      const { offsets } = layoutSpider(n);
      expect(minPairDistance(offsets), `n = ${n}`).toBeGreaterThanOrEqual(SPIDER_SPACING - 1e-9);
      for (const o of offsets) expect(Math.hypot(o.dx, o.dy)).toBeGreaterThanOrEqual(LOGO_DIAMETER + 8 - 1e-9);
    }
  });
});

describe("spiral", () => {
  it("keeps every pair of markers a full spacing apart (none overlap), for 9 to 20", () => {
    for (let n = 9; n <= SPIRAL_MAX; n++) {
      const { mode, offsets } = layoutSpider(n);
      expect(mode).toBe("spiral");
      expect(offsets).toHaveLength(n);
      // 48 px is the target; the straight-line gap between neighbours on a curve is a little under the arc length.
      expect(minPairDistance(offsets), `n = ${n}`).toBeGreaterThanOrEqual(SPIDER_SPACING - 1);
      expect(minPairDistance(offsets), `n = ${n}`).toBeGreaterThan(LOGO_DIAMETER);
    }
  });

  it("starts outside the largest circle and moves steadily outward", () => {
    const { offsets } = layoutSpider(20);
    const radii = offsets.map((o) => Math.hypot(o.dx, o.dy));
    expect(radii[0]).toBeGreaterThan(layoutSpider(8).offsets.map((o) => Math.hypot(o.dx, o.dy))[0]);
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeGreaterThan(radii[i - 1]);
    expect(Math.max(...radii)).toBeLessThan(150); // a 20-company spider spans under 300 px
  });
});

describe("list", () => {
  it("has no offsets", () => {
    expect(layoutSpider(21)).toEqual({ mode: "list", offsets: [] });
  });
});

describe("openSpider", () => {
  const view = viewFor({ lng: 77.5946, lat: 12.9716 }, 19, 1280, 800);
  const stack = { key: "s:o:5", lng: 77.5947, lat: 12.9717 };
  const members = (n: number): SpiderMember[] =>
    Array.from({ length: n }, (_, i) => ({ key: `o:${100 + i}`, kind: "logo", letter: "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[i % 26], swatch: i % 5, companyId: 100 + i }));

  it("places each member at its offset from the stack, in screen pixels at the opening zoom", () => {
    const n = 6;
    const spider = openSpider({ stack, members: members(n), view, zoom: 19 });
    const { offsets } = layoutSpider(n);
    const cx = screenX(view, lngToMercatorX(stack.lng));
    const cy = screenY(view, latToMercatorY(stack.lat));
    expect(spider.mode).toBe("circle");
    expect(spider.items).toHaveLength(n);
    spider.items.forEach((item, i) => {
      expect(screenX(view, lngToMercatorX(item.lng))).toBeCloseTo(cx + offsets[i].dx, 4);
      expect(screenY(view, latToMercatorY(item.lat))).toBeCloseTo(cy + offsets[i].dy, 4);
    });
  });

  it("keeps the members' keys and order, and gives each a leg from the true position", () => {
    const spider = openSpider({ stack, members: members(12), view, zoom: 19 });
    expect(spider.mode).toBe("spiral");
    expect(spider.items.map((i) => i.key)).toEqual(members(12).map((m) => m.key));
    expect(spider.memberKeys).toEqual(members(12).map((m) => m.key));
    expect(spider.legs).toHaveLength(12);
    spider.legs.forEach(([from, to], i) => {
      expect(from).toEqual([stack.lng, stack.lat]);
      expect(to).toEqual([spider.items[i].lng, spider.items[i].lat]);
    });
    expect(spider.zoom).toBe(19);
    expect(spider.origin).toEqual({ lng: stack.lng, lat: stack.lat });
  });

  it("opens the list for more than 20: no items and no legs, but the members are kept", () => {
    const spider = openSpider({ stack, members: members(21), view, zoom: 19 });
    expect(spider.mode).toBe("list");
    expect(spider.items).toEqual([]);
    expect(spider.legs).toEqual([]);
    expect(spider.memberKeys).toHaveLength(21);
  });

  it("makes the legs a GeoJSON line collection, and an empty one when closed", () => {
    const spider = openSpider({ stack, members: members(3), view, zoom: 19 });
    const geo = legsGeoJson(spider);
    expect(geo.type).toBe("FeatureCollection");
    expect(geo.features).toHaveLength(3);
    expect(geo.features[1].geometry.type).toBe("LineString");
    expect(geo.features[1].properties).toEqual({ member: "o:101" });
    expect(legsGeoJson(null).features).toEqual([]);
  });
});
