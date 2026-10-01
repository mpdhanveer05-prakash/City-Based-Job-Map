import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initialOf, swatchIndex } from "@/map/atlas/fallback";
import { GLYPH_CHARS, GLYPH_COLUMNS, GLYPH_COUNT, GLYPH_ROWS, glyphCell, layoutText, type GlyphMetrics } from "@/map/atlas/glyphs";
import { buildStaticScene } from "@/map/fixtures/static-scene";
import {
  CLUSTER_MAX_DIAMETER,
  CLUSTER_MIN_DIAMETER,
  LOGO_DIAMETER,
  SELECTED_SCALE,
  clusterDiameter,
  formatCount,
  intersectsViewport,
  latToMercatorY,
  lngToMercatorX,
  mercatorXToLng,
  mercatorYToLat,
  screenToLngLat,
  screenX,
  screenY,
  viewFor,
} from "@/map/layer/geometry";
import {
  FLOATS_PER_INSTANCE,
  FramePacker,
  STATIC_FLOATS,
  badgeLabel,
  prepareScene,
  type LayerItem,
  type ScenePalette,
} from "@/map/layer/instances";
import { MARKER_FRAGMENT, MARKER_VERTEX } from "@/map/layer/shaders/marker";
import { SWATCH_TOKENS, parseCssColor, resolveMarkerTheme } from "@/map/theme";

const METRICS: GlyphMetrics = { advances: Array.from({ length: GLYPH_COUNT }, () => 0.5) };
const PALETTE: ScenePalette = {
  swatches: [
    [0.1, 0, 0],
    [0.2, 0, 0],
    [0.3, 0, 0],
    [0.4, 0, 0],
    [0.5, 0, 0],
  ],
  logoFill: [0.9, 0.9, 0.9],
};
const VIEW = viewFor({ lng: 77.5946, lat: 12.9716 }, 12, 1000, 800);

describe("Web Mercator and the screen view", () => {
  it("puts null island in the middle of the world and round-trips coordinates", () => {
    expect(lngToMercatorX(0)).toBe(0.5);
    expect(latToMercatorY(0)).toBeCloseTo(0.5, 12);
    for (const [lng, lat] of [[77.5946, 12.9716], [80.2707, 13.0827], [-122.4, 37.8], [151.2, -33.9]]) {
      expect(mercatorXToLng(lngToMercatorX(lng))).toBeCloseTo(lng, 9);
      expect(mercatorYToLat(latToMercatorY(lat))).toBeCloseTo(lat, 9);
    }
  });

  it("projects the view centre to the canvas centre, and one world-width per 360 degrees", () => {
    const x = screenX(VIEW, lngToMercatorX(77.5946));
    const y = screenY(VIEW, latToMercatorY(12.9716));
    expect(x).toBeCloseTo(500, 9);
    expect(y).toBeCloseTo(400, 9);
    const east = screenX(VIEW, lngToMercatorX(77.5946 + 1)) - x;
    expect(east).toBeCloseTo((512 * 2 ** 12) / 360, 6); // 512 · 2^zoom px per 360 degrees
  });

  it("inverts the projection", () => {
    const { lng, lat } = screenToLngLat(VIEW, 123.5, 654.25);
    expect(screenX(VIEW, lngToMercatorX(lng))).toBeCloseTo(123.5, 6);
    expect(screenY(VIEW, latToMercatorY(lat))).toBeCloseTo(654.25, 6);
  });

  it("stays precise at zoom 17 where float32 would not", () => {
    const deep = viewFor({ lng: 77.5946, lat: 12.9716 }, 17, 1000, 800);
    const dx = 0.5 / deep.worldSize; // half a pixel in Mercator units
    expect(screenX(deep, lngToMercatorX(77.5946) + dx) - 500).toBeCloseTo(0.5, 6);
    expect(Math.fround(lngToMercatorX(77.5946) + dx) - Math.fround(lngToMercatorX(77.5946))).not.toBeCloseTo(dx, 12);
  });
});

describe("viewport culling with a 20% margin", () => {
  it("keeps a point exactly on the margin and drops one just past it", () => {
    expect(intersectsViewport(1200, 400, 0, VIEW)).toBe(true); // 1000 + 0.2 · 1000
    expect(intersectsViewport(1200.5, 400, 0, VIEW)).toBe(false);
    expect(intersectsViewport(-200, 400, 0, VIEW)).toBe(true);
    expect(intersectsViewport(-200.5, 400, 0, VIEW)).toBe(false);
    expect(intersectsViewport(500, 960, 0, VIEW)).toBe(true); // 800 + 0.2 · 800
    expect(intersectsViewport(500, 960.5, 0, VIEW)).toBe(false);
    expect(intersectsViewport(500, -160.5, 0, VIEW)).toBe(false);
  });

  it("counts a disc whose edge reaches into the margin", () => {
    expect(intersectsViewport(1230, 400, 30, VIEW)).toBe(true);
    expect(intersectsViewport(1231, 400, 30, VIEW)).toBe(false);
  });

  it("accepts a different margin", () => {
    expect(intersectsViewport(1100, 400, 0, VIEW, 0)).toBe(false);
    expect(intersectsViewport(1000, 400, 0, VIEW, 0)).toBe(true);
  });
});

describe("sizes and labels", () => {
  it("scales a cluster from 36 to 64 px with log(count)", () => {
    expect(clusterDiameter(1)).toBe(CLUSTER_MIN_DIAMETER);
    expect(clusterDiameter(1000)).toBe(CLUSTER_MAX_DIAMETER);
    expect(clusterDiameter(100_000)).toBe(CLUSTER_MAX_DIAMETER);
    let last = 0;
    for (const n of [1, 2, 5, 20, 100, 500, 1000]) {
      const d = clusterDiameter(n);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
    expect(clusterDiameter(10)).toBeGreaterThan(CLUSTER_MIN_DIAMETER);
    expect(clusterDiameter(10)).toBeLessThan(CLUSTER_MAX_DIAMETER);
  });

  it("formats counts in at most four glyphs", () => {
    const cases: Array<[number, string]> = [
      [0, "0"], [7, "7"], [999, "999"], [1000, "1k"], [1234, "1.2k"], [1950, "2k"],
      [9949, "9.9k"], [9950, "10k"], [9999, "10k"], [12_400, "12k"], [99_499, "99k"], [99_500, "99k+"], [1_000_000, "99k+"],
    ];
    for (const [count, label] of cases) expect(formatCount(count), String(count)).toBe(label);
    for (let n = 0; n < 200_000; n += 37) expect(formatCount(n).length).toBeLessThanOrEqual(4);
  });

  it("caps the stack badge at 99+", () => {
    expect(badgeLabel(2)).toBe("2");
    expect(badgeLabel(99)).toBe("99");
    expect(badgeLabel(100)).toBe("99+");
  });
});

describe("glyph sheet layout", () => {
  it("has a cell for every character, in a grid that holds them all", () => {
    expect(GLYPH_COLUMNS * GLYPH_ROWS).toBeGreaterThanOrEqual(GLYPH_COUNT);
    expect(new Set(GLYPH_CHARS).size).toBe(GLYPH_COUNT);
    for (const ch of "0123456789k.+ABCDEFGHIJKLMNOPQRSTUVWXYZ") expect(glyphCell(ch)).toBeGreaterThanOrEqual(0);
    expect(glyphCell("é")).toBe(-1);
  });

  it("centres a run on zero using each glyph's advance", () => {
    const layout = layoutText("123", METRICS);
    expect(layout.cells.slice(0, 3)).toEqual([glyphCell("1"), glyphCell("2"), glyphCell("3")]);
    expect(layout.cells[3]).toBe(-1);
    expect(layout.xs.slice(0, 3)).toEqual([-0.5, 0, 0.5]);
    expect(layout.width).toBe(1.5);
  });

  it("uses proportional advances", () => {
    const metrics: GlyphMetrics = { advances: METRICS.advances.slice() };
    metrics.advances[glyphCell(".")] = 0.25;
    const layout = layoutText("1.2", metrics);
    expect(layout.width).toBeCloseTo(1.25, 12);
    expect(layout.xs[0]).toBeCloseTo(-0.625 + 0.25, 12);
    expect(layout.xs[2]).toBeCloseTo(0.625 - 0.25, 12);
  });

  it("upper-cases letters, keeps the count suffix k, skips unknown characters, and stops at the maximum", () => {
    expect(layoutText("a", METRICS).cells[0]).toBe(glyphCell("A"));
    expect(layoutText("1k", METRICS).cells.slice(0, 2)).toEqual([glyphCell("1"), glyphCell("k")]);
    expect(layoutText("é1", METRICS).cells.slice(0, 2)).toEqual([glyphCell("1"), -1]);
    expect(layoutText("12345", METRICS).cells.filter((c) => c >= 0)).toHaveLength(4);
    expect(layoutText("12345", METRICS, 3).cells.filter((c) => c >= 0)).toHaveLength(3);
    expect(layoutText("", METRICS).width).toBe(0);
  });
});

describe("letter fallback", () => {
  it("picks the same swatch for the same name, ignoring case and outer spaces", () => {
    expect(swatchIndex("Acme Labs")).toBe(swatchIndex("  acme labs "));
    for (const name of ["Acme", "Zeta", "", "日本"]) {
      const i = swatchIndex(name);
      expect(Number.isInteger(i) && i >= 0 && i < 5).toBe(true);
    }
  });

  it("uses all five swatches across a spread of names", () => {
    const used = new Set(Array.from({ length: 300 }, (_, i) => swatchIndex(`Company ${i}`)));
    expect(used.size).toBe(5);
  });

  it("takes the first Latin letter, folding accents", () => {
    expect(initialOf("acme")).toBe("A");
    expect(initialOf("Émile & Co")).toBe("E");
    expect(initialOf("  42 Labs")).toBe("L");
    expect(initialOf("日本")).toBe("?");
  });
});

describe("marker theme", () => {
  const tokens: Record<string, string> = {
    "--mantis": "#59c749",
    "--milky": "#fffdf1",
    "--ink": "#1f3a1a",
    "--moss": "#5a6655",
    "--mantis-deep": "#2f7a24",
    "--swatch-sand": "#f2e2b3",
    "--swatch-sky": "#d6e4f0",
    "--swatch-rose": "#f0d5ce",
    "--swatch-lilac": "#e2daee",
    "--swatch-stone": "#e6e1d3",
  };

  it("takes each role from its design-system token", () => {
    const theme = resolveMarkerTheme((name) => tokens[name] ?? "");
    expect(theme.clusterFill).toBe(tokens["--mantis"]);
    expect(theme.clusterText).toBe(tokens["--ink"]);
    expect(theme.logoRing).toBe(tokens["--moss"]);
    expect(theme.selectionRing).toBe(tokens["--mantis-deep"]);
    expect(theme.stackBadge).toBe(tokens["--ink"]);
    expect(theme.stackBadgeText).toBe(tokens["--milky"]);
    expect(theme.swatches).toEqual(SWATCH_TOKENS.map((t) => tokens[t]));
  });

  it("names the missing token", () => {
    expect(() => resolveMarkerTheme((name) => (name === "--moss" ? "" : (tokens[name] ?? "#000")))).toThrow(/--moss/);
  });

  it("finds every token it reads in globals.css", () => {
    const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");
    const read: string[] = [];
    resolveMarkerTheme((name) => (read.push(name), "#000"));
    for (const name of read) expect(css, name).toMatch(new RegExp(`${name}:\\s*#[0-9a-fA-F]{6}`));
  });

  it("parses hex and rgb() colours", () => {
    expect(parseCssColor("#59c749")).toEqual([0x59 / 255, 0xc7 / 255, 0x49 / 255]);
    expect(parseCssColor("#FFF")).toEqual([1, 1, 1]);
    expect(parseCssColor("rgb(31 58 26)")).toEqual([31 / 255, 58 / 255, 26 / 255]);
    expect(parseCssColor("rgba(31, 58, 26, 0.5)")).toEqual([31 / 255, 58 / 255, 26 / 255]);
    expect(() => parseCssColor("green")).toThrow(/Cannot parse/);
  });

  it("has no raw hex colour in the layer, atlas, or shader sources", () => {
    const files = [...walk(join(__dirname, "../../map/layer")), ...walk(join(__dirname, "../../map/atlas"))];
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(MARKER_VERTEX + MARKER_FRAGMENT).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".ts") ? [path] : [];
  });
}

const base = (extra: Partial<LayerItem> & Pick<LayerItem, "key" | "kind">): LayerItem => ({ lng: 77.5946, lat: 12.9716, ...extra });

describe("prepareScene", () => {
  it("rejects a duplicate key", () => {
    expect(() => prepareScene([base({ key: "a", kind: "logo" }), base({ key: "a", kind: "logo" })], PALETTE, METRICS)).toThrow(/Duplicate marker key a/);
  });

  it("draws logos and stacks first, then clusters, then the selected item, keeping input order within a rank", () => {
    const scene = prepareScene(
      [
        base({ key: "sel", kind: "logo", selected: true }),
        base({ key: "cl1", kind: "cluster", count: 5 }),
        base({ key: "lg1", kind: "logo" }),
        base({ key: "st", kind: "stack", count: 3 }),
        base({ key: "cl2", kind: "cluster", count: 5 }),
        base({ key: "lg2", kind: "logo" }),
      ],
      PALETTE,
      METRICS,
    );
    expect(scene.keys).toEqual(["lg1", "st", "lg2", "cl1", "cl2", "sel"]);
  });

  it("sizes markers from their kind, count, and scale, and enlarges the selected one by 1.25", () => {
    const scene = prepareScene(
      [
        base({ key: "logo", kind: "logo" }),
        base({ key: "big", kind: "cluster", count: 1000 }),
        base({ key: "small", kind: "cluster", count: 2 }),
        base({ key: "scaled", kind: "logo", scale: 2 }),
        base({ key: "selected", kind: "logo", selected: true }),
      ],
      PALETTE,
      METRICS,
    );
    const radius = (key: string) => scene.statics[scene.keys.indexOf(key) * STATIC_FLOATS];
    expect(radius("logo")).toBe(LOGO_DIAMETER / 2);
    expect(radius("big")).toBe(CLUSTER_MAX_DIAMETER / 2);
    expect(radius("small")).toBeCloseTo(clusterDiameter(2) / 2, 5);
    expect(radius("scaled")).toBe(LOGO_DIAMETER);
    expect(radius("selected")).toBeCloseTo((LOGO_DIAMETER / 2) * SELECTED_SCALE, 5);
  });

  it("fills a logo from its swatch or Milky, and gives a cluster no fill of its own", () => {
    const scene = prepareScene(
      [base({ key: "a", kind: "logo", swatch: 2 }), base({ key: "b", kind: "logo" }), base({ key: "c", kind: "cluster", count: 4 })],
      PALETTE,
      METRICS,
    );
    const fill = (key: string) => Array.from(scene.statics.slice(scene.keys.indexOf(key) * STATIC_FLOATS + 4, scene.keys.indexOf(key) * STATIC_FLOATS + 7));
    expect(fill("a")[0]).toBeCloseTo(0.3, 6);
    expect(fill("b")[0]).toBeCloseTo(0.9, 6);
    expect(fill("c")).toEqual([0, 0, 0]);
  });

  it("encodes the selected and focus flags", () => {
    const scene = prepareScene(
      [base({ key: "n", kind: "logo" }), base({ key: "s", kind: "logo", selected: true }), base({ key: "f", kind: "logo", focused: true }), base({ key: "b", kind: "logo", selected: true, focused: true })],
      PALETTE,
      METRICS,
    );
    const flags = (key: string) => scene.statics[scene.keys.indexOf(key) * STATIC_FLOATS + 2];
    expect([flags("n"), flags("s"), flags("f"), flags("b")]).toEqual([0, 1, 2, 3]);
  });

  it("lays out a cluster's count, a logo's initial, and a stack's initial plus badge", () => {
    const scene = prepareScene(
      [
        base({ key: "cluster", kind: "cluster", count: 1234 }),
        base({ key: "logo", kind: "logo", letter: "Q" }),
        base({ key: "stack", kind: "stack", count: 30, letter: "Z" }),
      ],
      PALETTE,
      METRICS,
    );
    const cells = (key: string) => Array.from(scene.statics.slice(scene.keys.indexOf(key) * STATIC_FLOATS + 7, scene.keys.indexOf(key) * STATIC_FLOATS + 11));
    expect(cells("cluster")).toEqual([glyphCell("1"), glyphCell("."), glyphCell("2"), glyphCell("k")]);
    expect(cells("logo")).toEqual([glyphCell("Q"), -1, -1, -1]);
    expect(cells("stack")).toEqual([glyphCell("Z"), glyphCell("3"), glyphCell("0"), -1]);
    const badgeEm = (key: string) => scene.statics[scene.keys.indexOf(key) * STATIC_FLOATS + 16];
    expect(badgeEm("stack")).toBeGreaterThan(0);
    expect(badgeEm("logo")).toBe(0);
  });

  it("shrinks a cluster's text so a long label fits the disc", () => {
    const scene = prepareScene([base({ key: "short", kind: "cluster", count: 7 }), base({ key: "long", kind: "cluster", count: 1234 })], PALETTE, METRICS);
    const em = (key: string) => scene.statics[scene.keys.indexOf(key) * STATIC_FLOATS + 15];
    expect(em("long")).toBeLessThan(em("short"));
  });
});

describe("FramePacker", () => {
  const at = (key: string, x: number, y: number, extra: Partial<LayerItem> = {}): LayerItem => {
    const { lng, lat } = screenToLngLat(VIEW, x, y);
    return { key, kind: "logo", lng, lat, ...extra };
  };

  it("packs the screen position and the static floats, and reports what was culled", () => {
    const scene = prepareScene([at("in", 250, 300, { letter: "A", swatch: 1 }), at("far", 5000, 300), at("edge", 1190, 400)], PALETTE, METRICS);
    const packer = new FramePacker();
    const stats = packer.pack(scene, VIEW);
    expect(stats).toEqual({ drawn: 2, culled: 1 });
    expect(packer.x[0]).toBeCloseTo(250, 3);
    expect(packer.y[0]).toBeCloseTo(300, 3);
    expect(packer.data[0]).toBeCloseTo(250, 3);
    expect(packer.data[2]).toBe(LOGO_DIAMETER / 2);
    expect(Array.from(packer.indices.slice(0, 2)).map((i) => scene.keys[i])).toEqual(["in", "edge"]);
    expect(packer.data.length).toBeGreaterThanOrEqual(2 * FLOATS_PER_INSTANCE);
  });

  it("keeps an item whose ring reaches into the margin, and drops one clear of it", () => {
    const scene = prepareScene([at("ring", 1230, 400), at("clear", 1300, 400)], PALETTE, METRICS);
    const packer = new FramePacker();
    expect(packer.pack(scene, VIEW).drawn).toBe(1);
    expect(scene.keys[packer.indices[0]]).toBe("ring");
  });

  it("follows the camera: panning brings a culled item back", () => {
    const scene = prepareScene([at("east", 3000, 400)], PALETTE, METRICS);
    const packer = new FramePacker();
    expect(packer.pack(scene, VIEW).drawn).toBe(0);
    const panned = { ...VIEW, centerX: VIEW.centerX + 2500 / VIEW.worldSize };
    expect(packer.pack(scene, panned).drawn).toBe(1);
    expect(packer.x[0]).toBeCloseTo(500, 3);
  });

  it("grows its buffers for a large scene and reuses them for a small one", () => {
    const many = Array.from({ length: 3000 }, (_, i) => at(`k${i}`, 100 + (i % 50) * 10, 100 + Math.floor(i / 50) * 10));
    const big = prepareScene(many, PALETTE, METRICS);
    const packer = new FramePacker();
    expect(packer.pack(big, VIEW).drawn).toBe(3000);
    const buffer = packer.data;
    packer.pack(prepareScene(many.slice(0, 10), PALETTE, METRICS), VIEW);
    expect(packer.data).toBe(buffer);
  });
});

describe("the static scene", () => {
  const view = viewFor({ lng: 77.5946, lat: 12.9716 }, 12, 1280, 800);
  const items = buildStaticScene({ view });

  it("holds 60 clusters, 400 logos, 3 stacks, and 200 far items, all with unique keys", () => {
    const count = (kind: string) => items.filter((i) => i.kind === kind && !i.key.startsWith("syn:far")).length;
    expect(count("cluster")).toBe(60);
    expect(count("logo")).toBe(400);
    expect(count("stack")).toBe(3);
    expect(items.filter((i) => i.key.startsWith("syn:far"))).toHaveLength(200);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });

  it("draws the 463 in-view items and culls the 200 far ones", () => {
    const stats = new FramePacker().pack(prepareScene(items, PALETTE, METRICS), view);
    expect(stats).toEqual({ drawn: 463, culled: 200 });
  });

  it("marks one selected logo, one focused logo, and one selected cluster", () => {
    expect(items.filter((i) => i.selected && i.kind === "logo")).toHaveLength(1);
    expect(items.filter((i) => i.focused)).toHaveLength(1);
    expect(items.filter((i) => i.selected && i.kind === "cluster")).toHaveLength(1);
  });

  it("is deterministic for a seed and varies with it", () => {
    expect(buildStaticScene({ view })).toEqual(items);
    expect(buildStaticScene({ view, seed: 1 })).not.toEqual(items);
  });

  it("covers the full range of cluster labels and sizes", () => {
    const counts = items.filter((i) => i.kind === "cluster").map((i) => i.count!);
    expect(Math.min(...counts)).toBeLessThan(10);
    expect(Math.max(...counts)).toBeGreaterThan(1000);
  });
});
