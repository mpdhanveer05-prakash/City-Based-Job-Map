// Turns marker items into the per-instance floats the shader reads, and culls them per frame.
// Pure and DOM-free. Anything that does not change while the camera moves (size, colour, glyph layout) is
// computed once in prepareScene; per frame only the screen position is computed and copied.
import type { LogoRef } from "../atlas/logo-atlas.ts";
import { layoutText, type GlyphMetrics } from "../atlas/glyphs.ts";
import type { Rgb } from "../theme.ts";
import {
  CULL_MARGIN,
  LOGO_DIAMETER,
  SELECTED_SCALE,
  clusterDiameter,
  formatCount,
  intersectsViewport,
  latToMercatorY,
  lngToMercatorX,
  screenX,
  screenY,
  type View,
} from "./geometry.ts";
import { QUAD_PADDING } from "./shaders/marker.ts";

export type MarkerKind = "logo" | "cluster" | "stack";

export type LayerItem = {
  /** `o:<office>`, `c:<…>`, or a stack key. Unique within a scene. */
  key: string;
  lng: number;
  lat: number;
  kind: MarkerKind;
  /** Unique companies in a cluster or stack. Drives the label, and a cluster's size. */
  count?: number;
  /** The initial shown on a logo or the top of a stack (A–Z). */
  letter?: string;
  /** Letter-fallback swatch 0…4, or null/undefined for the Milky fill. */
  swatch?: number | null;
  /** The company, for the logo atlas. Logos are keyed by company, not by office. */
  companyId?: number;
  /** The company's logo. Without one (or while it loads, or if it fails) the letter fallback shows. */
  logoUrl?: string | null;
  selected?: boolean;
  focused?: boolean;
  /** 0…1, default 1. */
  opacity?: number;
  /** Multiplies the radius, default 1. */
  scale?: number;
};

export type ScenePalette = { swatches: Rgb[]; logoFill: Rgb };

const KIND_CODE: Record<MarkerKind, number> = { logo: 0, cluster: 1, stack: 2 };
const FLAG_SELECTED = 1;
const FLAG_FOCUS = 2;

/** Floats per instance: centre (2) + the static part (17) + the logo reference (4). Keep in step with the vertex attributes. */
export const STATIC_FLOATS = 17;
export const LOGO_FLOATS = 4;
export const FLOATS_PER_INSTANCE = 2 + STATIC_FLOATS + LOGO_FLOATS;

// Text sizes are ratios of the marker radius (the em box is the glyph cell).
const LOGO_EM = 1.5;
const CLUSTER_MAX_EM = 1.6;
const CLUSTER_TEXT_WIDTH = 1.45; // the run may span this many radii
const BADGE_MAX_EM = 0.95;
const BADGE_TEXT_WIDTH = 0.85;
const BADGE_GLYPHS = 3;

/** The stack badge shows at most "99+". */
export const badgeLabel = (count: number): string => (count > 99 ? "99+" : String(Math.max(0, Math.round(count))));

/** Draw order, bottom to top: logos and stacks, then clusters, then the selected item (map-spec §6). */
const zRank = (item: LayerItem): number => (item.selected ? 2 : item.kind === "cluster" ? 1 : 0);

export type PreparedScene = {
  count: number;
  keys: string[];
  kinds: MarkerKind[];
  mx: Float64Array;
  my: Float64Array;
  /** `STATIC_FLOATS` per item: radius, kind, flags, opacity, fill rgb, cells ×4, xs ×4, em, badge em. */
  statics: Float32Array;
  /** Index in the caller's item array of each scene item: the scene is drawn in z order, not input order. */
  sourceIndex: Int32Array;
  /** -1 when the item has no company. */
  companyIds: Int32Array;
  /** The logo to load, or null. Always null for clusters. */
  logoUrls: Array<string | null>;
};

export function prepareScene(items: readonly LayerItem[], palette: ScenePalette, metrics: GlyphMetrics): PreparedScene {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.key)) throw new Error(`Duplicate marker key ${item.key}: a key is drawn once.`);
    seen.add(item.key);
  }
  // Stable sort: equal ranks keep the caller's order.
  const sorted = items.map((item, i) => ({ item, i })).sort((a, b) => zRank(a.item) - zRank(b.item) || a.i - b.i);

  const n = sorted.length;
  const scene: PreparedScene = {
    count: n,
    keys: new Array(n),
    kinds: new Array(n),
    mx: new Float64Array(n),
    my: new Float64Array(n),
    statics: new Float32Array(n * STATIC_FLOATS),
    sourceIndex: new Int32Array(n),
    companyIds: new Int32Array(n).fill(-1),
    logoUrls: new Array(n).fill(null),
  };

  sorted.forEach(({ item, i: sourceIndex }, i) => {
    scene.sourceIndex[i] = sourceIndex;
    scene.keys[i] = item.key;
    scene.kinds[i] = item.kind;
    scene.mx[i] = lngToMercatorX(item.lng);
    scene.my[i] = latToMercatorY(item.lat);
    if (item.kind !== "cluster" && item.companyId !== undefined && item.logoUrl) {
      scene.companyIds[i] = item.companyId;
      scene.logoUrls[i] = item.logoUrl;
    }

    const base = item.kind === "cluster" ? clusterDiameter(item.count ?? 2) : LOGO_DIAMETER;
    const radius = (base / 2) * (item.scale ?? 1) * (item.selected ? SELECTED_SCALE : 1);

    let cells: number[] = [-1, -1, -1, -1];
    let xs: number[] = [0, 0, 0, 0];
    let em = LOGO_EM;
    let badgeEm = 0;
    if (item.kind === "cluster") {
      const layout = layoutText(formatCount(item.count ?? 0), metrics);
      cells = layout.cells;
      xs = layout.xs;
      em = Math.min(CLUSTER_MAX_EM, CLUSTER_TEXT_WIDTH / Math.max(layout.width, 0.01));
    } else {
      const letter = layoutText(item.letter ?? "?", metrics, 1);
      cells = [letter.cells[0], -1, -1, -1];
      if (item.kind === "stack") {
        const badge = layoutText(badgeLabel(item.count ?? 2), metrics, BADGE_GLYPHS);
        cells = [letter.cells[0], badge.cells[0], badge.cells[1], badge.cells[2]];
        xs = [0, badge.xs[0], badge.xs[1], badge.xs[2]];
        badgeEm = Math.min(BADGE_MAX_EM, BADGE_TEXT_WIDTH / Math.max(badge.width, 0.01));
      }
    }

    const swatch = item.swatch;
    const fill = item.kind === "cluster" ? [0, 0, 0] : swatch == null ? palette.logoFill : palette.swatches[swatch];
    const flags = (item.selected ? FLAG_SELECTED : 0) | (item.focused ? FLAG_FOCUS : 0);

    scene.statics.set(
      [radius, KIND_CODE[item.kind], flags, item.opacity ?? 1, fill[0], fill[1], fill[2], ...cells, ...xs, em, badgeEm],
      i * STATIC_FLOATS,
    );
  });
  return scene;
}

export type FrameStats = { drawn: number; culled: number };

/** Per-frame state from the animator, by scene index. It replaces the scene's fixed position, size, and opacity. */
export type DynamicState = {
  /** Mercator x and y. */
  x: Float64Array;
  y: Float64Array;
  /** Multiplies the radius. */
  scale: Float32Array;
  /** Multiplies the item's opacity. */
  opacity: Float32Array;
};

/** An item this faint or this small is not drawn at all. */
const MIN_OPACITY = 0.003;
const MIN_SCALE = 0.01;

/** Per-frame projection, culling, and packing into one reusable buffer. */
export class FramePacker {
  data = new Float32Array(0);
  /** Scene index of each packed instance, in draw order. */
  indices = new Int32Array(0);
  /** Screen position (CSS px) of each packed instance. */
  x = new Float32Array(0);
  y = new Float32Array(0);
  /** Drawn radius (px) of each packed instance, after animation. */
  r = new Float32Array(0);

  private ensure(capacity: number): void {
    if (this.indices.length >= capacity) return;
    const grown = Math.max(capacity, this.indices.length * 2, 256);
    this.data = new Float32Array(grown * FLOATS_PER_INSTANCE);
    this.indices = new Int32Array(grown);
    this.x = new Float32Array(grown);
    this.y = new Float32Array(grown);
    this.r = new Float32Array(grown);
  }

  /**
   * `logoFor` is asked for each drawn item (by scene index) and returns its atlas cell, or null to draw the
   * letter fallback. It is not called for items that were culled, so only visible markers load logos.
   */
  pack(
    scene: PreparedScene,
    view: View,
    options: { margin?: number; logoFor?: (sceneIndex: number) => LogoRef | null; dynamic?: DynamicState } = {},
  ): FrameStats {
    const margin = options.margin ?? CULL_MARGIN;
    const dynamic = options.dynamic;
    this.ensure(scene.count);
    let drawn = 0;
    for (let i = 0; i < scene.count; i++) {
      const s = i * STATIC_FLOATS;
      const scale = dynamic ? dynamic.scale[i] : 1;
      const fade = dynamic ? dynamic.opacity[i] : 1;
      if (fade < MIN_OPACITY || scale < MIN_SCALE) continue; // invisible: faded out, or not grown yet
      const radius = scene.statics[s] * scale;
      const x = screenX(view, dynamic ? dynamic.x[i] : scene.mx[i]);
      const y = screenY(view, dynamic ? dynamic.y[i] : scene.my[i]);
      // Rings and the badge reach past the disc, so cull on the padded extent.
      if (!intersectsViewport(x, y, radius + QUAD_PADDING, view, margin)) continue;
      const o = drawn * FLOATS_PER_INSTANCE;
      this.data[o] = x;
      this.data[o + 1] = y;
      for (let k = 0; k < STATIC_FLOATS; k++) this.data[o + 2 + k] = scene.statics[s + k];
      this.data[o + 2] = radius; // static float 0 is the radius, 3 the opacity
      this.data[o + 5] = scene.statics[s + 3] * fade;
      const logo = options.logoFor ? options.logoFor(i) : null;
      const l = o + 2 + STATIC_FLOATS;
      this.data[l] = logo ? logo.page : -1;
      this.data[l + 1] = logo ? logo.u : 0;
      this.data[l + 2] = logo ? logo.v : 0;
      this.data[l + 3] = logo ? logo.mix : 0;
      this.indices[drawn] = i;
      this.x[drawn] = x;
      this.y[drawn] = y;
      this.r[drawn] = radius;
      drawn++;
    }
    return { drawn, culled: scene.count - drawn };
  }
}
