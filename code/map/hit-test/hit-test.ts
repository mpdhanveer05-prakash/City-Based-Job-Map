// Hit testing for the marker layer (map-spec §6). Pure and DOM-free.
//
// It works on what is drawn *now*: the items the layer reports for its last frame, at their animated screen
// positions and sizes. While markers move it scans them linearly; once the view has settled it uses a KDBush
// index, rebuilt only when a new frame has been drawn since the last build.
import KDBush from "kdbush";

export type MarkerKindName = "logo" | "cluster" | "stack";

/** One drawn marker. The layer's `getDrawn()` returns these in draw order, bottom to top. */
export type HitCandidate = {
  key: string;
  kind: MarkerKindName;
  /** Screen position, CSS px. */
  x: number;
  y: number;
  /** The drawn radius, px, after animation. */
  radius: number;
  selected?: boolean;
  /** 0…1 as drawn. A marker that is nearly faded out is not a target. */
  opacity?: number;
};

export type PointerKind = "touch" | "mouse";

/** Hit radius around a marker's centre, px: at least this far for touch and for a mouse (map-spec §6). */
export const HIT_RADIUS: Record<PointerKind, number> = { touch: 44, mouse: 24 };

/** Below this opacity a marker is a fade-in or fade-out in progress and is not under the finger. */
export const MIN_HIT_OPACITY = 0.25;

type Scored = { item: HitCandidate; distance: number };

/** The layer's draw order, top first: the selected marker, then clusters, then logos and stacks (instances.ts zRank). */
const rank = (item: HitCandidate): number => (item.selected ? 2 : item.kind === "cluster" ? 1 : 0);

const lexical = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The deterministic overlap rule (map-spec §6), applied to candidates that already passed the radius test.
 *
 * 1. A marker whose *drawn* disc contains the point beats one reached only through the extra hit radius: a tap
 *    selects what is under the finger.
 * 2. Among those: the selected marker, then the one drawn on top by rank (clusters are above logos and stacks,
 *    the selected marker above all), then the nearest centre, then the lowest key. Nothing depends on the order
 *    the markers are listed in, so the answer is the same on every machine.
 * 3. When nothing is under the finger and the radius found several, the nearest *edge* wins, then the same order.
 */
function choose(scored: Scored[]): HitCandidate | null {
  if (scored.length === 0) return null;
  const direct = scored.filter((s) => s.distance <= s.item.radius);
  const pool = direct.length > 0 ? direct : scored;
  const edge = (s: Scored) => (direct.length > 0 ? 0 : s.distance - s.item.radius);
  pool.sort(
    (a, b) =>
      edge(a) - edge(b) ||
      Number(!!b.item.selected) - Number(!!a.item.selected) ||
      rank(b.item) - rank(a.item) ||
      a.distance - b.distance ||
      lexical(a.item.key, b.item.key),
  );
  return pool[0].item;
}

function score(items: readonly HitCandidate[], indices: Iterable<number>, x: number, y: number, pointer: PointerKind): Scored[] {
  const slop = HIT_RADIUS[pointer];
  const out: Scored[] = [];
  for (const i of indices) {
    const item = items[i];
    if ((item.opacity ?? 1) < MIN_HIT_OPACITY) continue;
    const distance = Math.hypot(item.x - x, item.y - y);
    if (distance <= Math.max(item.radius, slop)) out.push({ item, distance });
  }
  return out;
}

/** Linear scan. Used while anything is moving, and as the reference the index must agree with. */
export function hitTestLinear(items: readonly HitCandidate[], x: number, y: number, pointer: PointerKind): HitCandidate | null {
  return choose(score(items, items.keys(), x, y, pointer));
}

/** A KDBush index over one frame's markers. Build once per settled frame, query as often as needed. */
export class HitIndex {
  private readonly tree: KDBush;
  private readonly maxRadius: number;

  constructor(private readonly items: readonly HitCandidate[]) {
    this.tree = new KDBush(Math.max(items.length, 1));
    let max = 0;
    for (const item of items) {
      this.tree.add(item.x, item.y);
      max = Math.max(max, item.radius);
    }
    // KDBush needs at least one point to finish; an empty frame gets a dummy that no query reaches.
    if (items.length === 0) this.tree.add(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    this.tree.finish();
    this.maxRadius = max;
  }

  query(x: number, y: number, pointer: PointerKind): HitCandidate | null {
    if (this.items.length === 0) return null;
    const reach = Math.max(this.maxRadius, HIT_RADIUS[pointer]);
    return choose(score(this.items, this.tree.within(x, y, reach), x, y, pointer));
  }
}

export type HitFrame = {
  items: readonly HitCandidate[];
  /** A counter that changes whenever the layer draws a frame (the layer's `stats.frames`). */
  frame: number;
  /** True while any marker is moving, growing, or fading. */
  animating: boolean;
};

/** Picks the method: a linear scan while animating, the index when settled. */
export class HitTester {
  private index: HitIndex | null = null;
  private builtFor = Number.NaN;
  /** How the last call was answered, for tests and the debug hook. */
  lastMethod: "linear" | "index" | null = null;
  /** How many times the index was built. */
  builds = 0;

  test(frame: HitFrame, x: number, y: number, pointer: PointerKind): HitCandidate | null {
    if (frame.animating) {
      this.lastMethod = "linear";
      return hitTestLinear(frame.items, x, y, pointer);
    }
    if (!this.index || this.builtFor !== frame.frame) {
      this.index = new HitIndex(frame.items);
      this.builtFor = frame.frame;
      this.builds++;
    }
    this.lastMethod = "index";
    return this.index.query(x, y, pointer);
  }
}
