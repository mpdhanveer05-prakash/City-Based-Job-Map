import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import {
  applyBasemapTheme,
  basemapStyleUrl,
  createRequestCounter,
  loadBasemapStyle,
} from "@/map/basemap";
import { resolveBasemapTheme } from "@/map/theme";

const css = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");
const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
const tokens = new Map([...rootBlock.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));
const theme = resolveBasemapTheme((name) => tokens.get(name) ?? "");

// Layer ids and the green/grey/pink originals mirror Geoapify's Positron style (checked 1 Oct 2026).
const ORIGINAL_GREEN = "rgb(60, 180, 60)";
const stops = { base: 1, stops: [[5.8, "hsla(0, 0%, 85%, 0.53)"], [6, "#fff"]] };
const layers = [
  { id: "background", type: "background", paint: { "background-color": "rgb(242,243,240)" } },
  { id: "park", type: "fill", source: "default", paint: { "fill-color": ORIGINAL_GREEN } },
  { id: "landcover_wood", type: "fill", source: "default", paint: { "fill-color": ORIGINAL_GREEN } },
  { id: "landuse_residential", type: "fill", source: "default", paint: { "fill-color": ORIGINAL_GREEN } },
  { id: "water", type: "fill", source: "default", paint: { "fill-color": "rgb(194, 200, 202)" } },
  { id: "waterway", type: "line", source: "default", paint: { "line-color": "hsl(195, 17%, 78%)" } },
  { id: "building", type: "fill", source: "default", paint: { "fill-color": "#eee", "fill-outline-color": "#ddd" } },
  { id: "highway_minor", type: "line", source: "default", paint: { "line-color": "hsl(0, 0%, 88%)" } },
  { id: "highway_major_casing", type: "line", source: "default", paint: { "line-color": "rgb(213,213,213)" } },
  { id: "highway_major_inner", type: "line", source: "default", paint: { "line-color": "#fff" } },
  { id: "highway_motorway_inner", type: "line", source: "default", paint: { "line-color": stops } },
  { id: "railway", type: "line", source: "default", paint: { "line-color": "#dddddd" } },
  { id: "railway_dashline", type: "line", source: "default", paint: { "line-color": "#fafafa" } },
  { id: "boundary_state", type: "line", source: "default", paint: { "line-color": "rgb(230, 204, 207)" } },
  {
    id: "place_city",
    type: "symbol",
    source: "default",
    layout: { "text-field": "{name}" },
    paint: { "text-color": "rgb(117,129,145)", "text-halo-color": "#fff", "text-halo-width": 1 },
  },
] as LayerSpecification[];
const style: StyleSpecification = { version: 8, sources: {}, layers };

function colours(s: StyleSpecification): unknown[] {
  return s.layers.flatMap((l) =>
    Object.entries(("paint" in l ? l.paint : undefined) ?? {})
      .filter(([key]) => key.endsWith("-color"))
      .map(([, value]) => value),
  );
}

describe("basemap theme", () => {
  it("resolves every role from the CSS tokens", () => {
    expect(theme.land).toBe("#fffdf1");
    expect(theme.park).toBe("#ece9d6");
    expect(theme.water).toBe("#d6e4f0");
    expect(theme.building).toBe("#f4f0da");
    expect(theme.label).toBe("#5a6655");
  });

  it("throws when a token is missing", () => {
    expect(() => resolveBasemapTheme(() => "")).toThrow(/not defined/);
  });
});

describe("applyBasemapTheme", () => {
  const themed = applyBasemapTheme(style, theme);
  const byId = (id: string) => themed.layers.find((l) => l.id === id) as LayerSpecification & { paint: Record<string, unknown> };

  it("paints land Milky and parks stone, never green", () => {
    expect(byId("background").paint["background-color"]).toBe(theme.land);
    expect(byId("park").paint["fill-color"]).toBe(theme.park);
    expect(byId("landcover_wood").paint["fill-color"]).toBe(theme.park);
    expect(byId("landuse_residential").paint["fill-color"]).toBe(theme.land);
  });

  it("paints water, buildings, roads, rail and boundaries from the theme", () => {
    expect(byId("water").paint["fill-color"]).toBe(theme.water);
    expect(byId("waterway").paint["line-color"]).toBe(theme.water);
    expect(byId("building").paint["fill-color"]).toBe(theme.building);
    expect(byId("highway_major_inner").paint["line-color"]).toBe(theme.road);
    expect(byId("highway_major_casing").paint["line-color"]).toBe(theme.roadCasing);
    // Zoom-stop colours collapse to one token colour.
    expect(byId("highway_motorway_inner").paint["line-color"]).toBe(theme.road);
    // Unlined thin roads would vanish as white on Milky.
    expect(byId("highway_minor").paint["line-color"]).toBe(theme.roadCasing);
    expect(byId("railway").paint["line-color"]).toBe(theme.roadCasing);
    expect(byId("railway_dashline").paint["line-color"]).toBe(theme.road);
    expect(byId("boundary_state").paint["line-color"]).toBe(theme.boundary);
  });

  it("sets labels to Moss with a 1.5 px Milky halo and keeps the layout", () => {
    const label = byId("place_city");
    expect(label.paint["text-color"]).toBe(theme.label);
    expect(label.paint["text-halo-color"]).toBe(theme.labelHalo);
    expect(label.paint["text-halo-width"]).toBe(1.5);
    expect(label.layout).toEqual({ "text-field": "{name}" });
  });

  it("leaves no colour outside the theme", () => {
    const allowed = new Set(Object.values(theme));
    for (const colour of colours(themed)) expect(allowed.has(colour as string)).toBe(true);
    expect(JSON.stringify(themed)).not.toContain(ORIGINAL_GREEN);
  });

  it("does not mutate its input", () => {
    expect(JSON.stringify(style)).toContain(ORIGINAL_GREEN);
  });
});

describe("loading and counting", () => {
  it("builds the style URL with an encoded key", () => {
    expect(basemapStyleUrl("a b")).toBe(
      "https://maps.geoapify.com/v1/styles/positron/style.json?apiKey=a%20b",
    );
  });

  it("fetches the style and themes it", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify(style))) as typeof fetch;
    const loaded = await loadBasemapStyle("k", theme, { fetchImpl });
    expect(JSON.stringify(loaded)).not.toContain(ORIGINAL_GREEN);
  });

  it("reports a failed request without leaking the key", async () => {
    const fetchImpl = (async () => new Response("denied", { status: 401 })) as typeof fetch;
    const error = await loadBasemapStyle("secret-key", theme, { fetchImpl }).catch((e: Error) => e);
    expect((error as Error).message).toBe("Basemap style request failed with HTTP 401");
    expect((error as Error).message).not.toContain("secret-key");
  });

  it("counts requests by kind and tiles separately", () => {
    const { stats, transformRequest } = createRequestCounter();
    for (const type of ["Style", "Source", "Tile", "Tile", "Glyphs", "SpriteJSON", "SpriteImage", "Image"]) {
      expect(transformRequest("https://example.test/x", type)).toEqual({ url: "https://example.test/x" });
    }
    expect(stats.counts).toEqual({ style: 1, tilejson: 1, tile: 2, glyphs: 1, sprite: 2, other: 1 });
    expect(stats.tileRequests).toBe(2);
  });
});
