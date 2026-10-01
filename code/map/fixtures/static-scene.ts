// A fixed marker scene for the P2-03 prototype and its tests: 60 clusters and 400 logos inside the viewport,
// a few stacks, one selected and one keyboard-focused marker, and a ring of items far outside it that the
// layer must cull. Everything is synthetic (map-spec §10): letters and counts are random, not real companies.
import type { LayerItem } from "../layer/instances.ts";
import { LOGO_DIAMETER, clusterDiameter, screenToLngLat, type View } from "../layer/geometry.ts";

export type StaticSceneOptions = {
  view: View;
  seed?: number;
  clusters?: number;
  logos?: number;
  stacks?: number;
  /** Items placed well outside the culling margin. */
  offscreen?: number;
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function buildStaticScene(options: StaticSceneOptions): LayerItem[] {
  const { view } = options;
  const rand = mulberry32(options.seed ?? 20_261_001);
  const clusters = options.clusters ?? 60;
  const logos = options.logos ?? 400;
  const stacks = options.stacks ?? 3;
  const offscreen = options.offscreen ?? 200;

  type Spec = { item: Omit<LayerItem, "lng" | "lat">; radius: number };
  const specs: Spec[] = [];
  for (let i = 0; i < clusters; i++) {
    // Log-uniform from 2 to 1,500, so the labels run from "2" to "1.5k" and the sizes cover 36…64 px.
    const count = Math.round(Math.exp(Math.log(2) + rand() * (Math.log(1500) - Math.log(2))));
    specs.push({ item: { key: `syn:cluster:${i}`, kind: "cluster", count }, radius: clusterDiameter(count) / 2 });
  }
  for (let i = 0; i < logos; i++) {
    specs.push({
      item: {
        key: `syn:logo:${i}`,
        kind: "logo",
        letter: LETTERS[Math.floor(rand() * 26)],
        swatch: Math.floor(rand() * 5),
      },
      radius: LOGO_DIAMETER / 2,
    });
  }
  const stackCounts = [2, 30, 120, 8, 21, 9];
  for (let i = 0; i < stacks; i++) {
    specs.push({
      item: {
        key: `syn:stack:${i}`,
        kind: "stack",
        count: stackCounts[i % stackCounts.length],
        letter: LETTERS[Math.floor(rand() * 26)],
        swatch: Math.floor(rand() * 5),
      },
      radius: LOGO_DIAMETER / 2,
    });
  }
  // One of each state, so the screenshot shows the selection ring, the focus ring, and a cluster with a ring.
  const firstLogo = specs.find((s) => s.item.kind === "logo");
  const secondLogo = specs.filter((s) => s.item.kind === "logo")[1];
  const firstCluster = specs.find((s) => s.item.kind === "cluster");
  if (firstLogo) firstLogo.item.selected = true;
  if (secondLogo) secondLogo.item.focused = true;
  if (firstCluster) firstCluster.item.selected = true;

  // Place without overlap where the viewport has room. A small phone cannot hold 460 markers, so the
  // required gap shrinks until each one fits: overlap there is expected and not a defect.
  const pad = 34;
  const placed: Array<{ x: number; y: number; r: number }> = [];
  let relax = 1;
  const inView = (s: Spec) => {
    for (;;) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const x = pad + rand() * Math.max(1, view.width - 2 * pad);
        const y = pad + rand() * Math.max(1, view.height - 2 * pad);
        if (placed.every((p) => Math.hypot(p.x - x, p.y - y) >= (p.r + s.radius + 4) * relax)) {
          placed.push({ x, y, r: s.radius });
          return { x, y };
        }
      }
      relax *= 0.92;
    }
  };

  const out: LayerItem[] = specs.map((s) => {
    const { x, y } = inView(s);
    const { lng, lat } = screenToLngLat(view, x, y);
    return { ...s.item, lng, lat };
  });

  // Far outside the +20% margin on both axes: at least half a viewport beyond every edge.
  for (let i = 0; i < offscreen; i++) {
    const side = i % 4;
    const far = 1.5 + rand() * 1.5;
    const x = side === 0 ? -far * view.width : side === 1 ? (1 + far) * view.width : rand() * view.width;
    const y = side === 2 ? -far * view.height : side === 3 ? (1 + far) * view.height : rand() * view.height;
    const { lng, lat } = screenToLngLat(view, x, y);
    out.push({ key: `syn:far:${i}`, kind: "logo", letter: LETTERS[i % 26], swatch: i % 5, lng, lat });
  }
  return out;
}
