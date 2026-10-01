// The marker animator (map-spec §4): split and merge as position, scale, and opacity together.
// Pure and DOM-free: time is passed in, so tests run it with a fake clock.
//
// Each key has one transition segment (from → to, started at t0). A new update never restarts from the old start:
// every segment begins at the item's *current* interpolated state, so a second zoom in mid-flight, a reversal, or a
// filter change continues smoothly and nothing snaps. The render list is a Map keyed by key, so a key is drawn once.
import {
  CROSSFADE_MS,
  MAX_MOVING,
  MERGE_MS,
  PAN_MS,
  REDUCED_MS,
  SPLIT_MS,
  clamp01,
  easeInCubic,
  easeOutCubic,
  lerp,
  linear,
  type Easing,
} from "./easing.ts";

export type AnimTarget<T> = {
  item: T;
  /** The item's final place, in Mercator units. */
  mx: number;
  my: number;
  /** The item that contains this one one level out (its own key when it survives), from the worker lineage. */
  parentKey: string;
  /** This item's keys one level in (its own key when it does not split). */
  childKeys: readonly string[];
};

export type AnimUpdate<T> = {
  /** Updates older than the latest applied generation are ignored. */
  generation: number;
  level: number;
  /** `dataVersion:filterHash`. A new namespace is a different scene: the old one fades out, the new one in. */
  namespace: string;
  targets: ReadonlyArray<AnimTarget<T>>;
  now: number;
};

export type AnimMode = "initial" | "split" | "merge" | "pan" | "data" | "jump" | "reduced" | "degraded";

export type AnimStats = {
  mode: AnimMode;
  /** Items that moved (not just faded) in the last update. */
  moving: number;
  /** True when the last update cross-faded because more than `maxMoving` items would have moved. */
  degraded: boolean;
  updates: number;
};

export type AnimOutput = { x: Float64Array; y: Float64Array; scale: Float32Array; opacity: Float32Array };

type State<T> = {
  item: T;
  fx: number; fy: number; fs: number; fo: number;
  tx: number; ty: number; ts: number; to: number;
  t0: number;
  dur: number;
  ease: Easing;
  leaving: boolean;
};

export type AnimatorOptions = {
  maxMoving?: number;
  /** Read at each update, so a change in the OS setting applies from the next one. */
  reducedMotion?: () => boolean;
};

const EPS = 1e-9;

export class Animator<T extends { key: string }> {
  private readonly states = new Map<string, State<T>>();
  private list: State<T>[] = [];
  private level = 0;
  private namespace = "";
  private generation = -Infinity;
  private readonly maxMoving: number;
  private readonly reducedMotion: () => boolean;
  readonly stats: AnimStats = { mode: "initial", moving: 0, degraded: false, updates: 0 };

  constructor(options: AnimatorOptions = {}) {
    this.maxMoving = options.maxMoving ?? MAX_MOVING;
    this.reducedMotion =
      options.reducedMotion ?? (() => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /** Everything currently on the render list, including items that are fading out. Order is stable between updates. */
  get items(): T[] {
    return this.list.map((s) => s.item);
  }

  get size(): number {
    return this.list.length;
  }

  /** Replace the scene at once, with no animation (selection changes, tests, a hard reset). */
  reset(input: Omit<AnimUpdate<T>, "now">): void {
    this.states.clear();
    for (const t of input.targets) {
      this.states.set(t.item.key, this.settled(t.item, t.mx, t.my));
    }
    this.list = Array.from(this.states.values());
    this.level = input.level;
    this.namespace = input.namespace;
    this.generation = input.generation;
    this.stats.mode = "initial";
    this.stats.moving = 0;
    this.stats.degraded = false;
  }

  /**
   * Retarget every transition at `now`. Returns false (and changes nothing) if the update is older than the
   * latest one already applied.
   */
  update(input: AnimUpdate<T>): boolean {
    const { generation, level, namespace, targets, now } = input;
    if (generation < this.generation) return false;
    this.generation = generation;

    // Finished fade-outs go now; they could not go earlier because the layer's arrays are built per update.
    for (const [key, s] of this.states) if (s.leaving && this.progress(s, now) >= 1) this.states.delete(key);

    const targetByKey = new Map(targets.map((t) => [t.item.key, t]));
    let mode: AnimMode;
    if (this.states.size === 0) mode = "initial";
    else if (namespace !== this.namespace) mode = "data";
    else if (level === this.level) mode = "pan";
    else mode = Math.abs(level - this.level) === 1 ? (level > this.level ? "split" : "merge") : "jump";

    // Which previous items merge into which new cluster (zooming out): a new item lists its children.
    const mergeInto = new Map<string, AnimTarget<T>>();
    if (mode === "merge") {
      for (const t of targets) for (const child of t.childKeys) if (child !== t.item.key) mergeInto.set(child, t);
    }

    // Count what would move. Past the limit, cross-fade instead and say so.
    let moving = 0;
    if (mode === "split") {
      for (const t of targets) if (!this.states.has(t.item.key) && this.states.has(t.parentKey)) moving++;
    } else if (mode === "merge") {
      for (const key of this.states.keys()) if (!targetByKey.has(key) && mergeInto.has(key)) moving++;
    }
    const degraded = moving > this.maxMoving;
    const reduced = this.reducedMotion();
    if (degraded) mode = "degraded";
    else if (reduced) mode = "reduced";
    if (degraded || reduced) moving = 0;

    const duration = this.durationFor(mode);
    const ease = this.easeFor(mode);

    // Existing items: continue from where they are now.
    for (const [key, s] of this.states) {
      const t = targetByKey.get(key);
      if (t) {
        s.item = t.item;
        s.leaving = false;
        this.aim(s, now, t.mx, t.my, 1, 1, duration, ease);
        continue;
      }
      if (s.leaving && mode === "pan") continue; // already fading out: let it finish rather than restart
      s.leaving = true;
      const cur = this.current(s, now);
      const dest = mode === "merge" ? mergeInto.get(key) : undefined;
      if (dest) this.aim(s, now, dest.mx, dest.my, 0, 0, duration, ease);
      else if (mode === "split") this.aim(s, now, cur.x, cur.y, 0, 0, duration, ease); // the parent shrinks away
      else this.aim(s, now, cur.x, cur.y, cur.scale, 0, duration, linear);
    }

    // New items.
    for (const t of targets) {
      if (this.states.has(t.item.key)) continue;
      const parent = mode === "split" ? this.states.get(t.parentKey) : undefined;
      const s = this.settled(t.item, t.mx, t.my);
      if (parent) {
        const p = this.current(parent, now);
        s.fx = p.x; s.fy = p.y; s.fs = 0; s.fo = 0; // born at the parent, from nothing
      } else if (mode === "merge") {
        s.fs = 0; s.fo = 0; // the new cluster grows in where it is
      } else {
        s.fo = 0; // fades in place
      }
      s.t0 = now;
      s.dur = duration;
      s.ease = ease;
      this.states.set(t.item.key, s);
    }

    this.list = Array.from(this.states.values());
    this.level = level;
    this.namespace = namespace;
    this.stats.mode = mode;
    this.stats.moving = moving;
    this.stats.degraded = degraded;
    this.stats.updates++;
    return true;
  }

  /**
   * Writes each item's state at `now`. `order[i]` is the index in `items` of the i-th output slot, for a caller
   * that keeps its own draw order; without it the outputs follow `items`. Returns true while anything is still
   * moving, so the caller knows to repaint.
   */
  sample(now: number, out: AnimOutput, order?: ArrayLike<number>): boolean {
    const n = order ? order.length : this.list.length;
    let animating = false;
    for (let i = 0; i < n; i++) {
      const s = this.list[order ? order[i] : i];
      const p = this.progress(s, now);
      const e = p >= 1 ? 1 : s.ease(p);
      out.x[i] = lerp(s.fx, s.tx, e);
      out.y[i] = lerp(s.fy, s.ty, e);
      out.scale[i] = lerp(s.fs, s.ts, e);
      out.opacity[i] = lerp(s.fo, s.to, e);
      if (p < 1) animating = true;
    }
    return animating;
  }

  private progress(s: State<T>, now: number): number {
    return s.dur <= 0 ? 1 : clamp01((now - s.t0) / s.dur);
  }

  private current(s: State<T>, now: number): { x: number; y: number; scale: number; opacity: number } {
    const p = this.progress(s, now);
    const e = p >= 1 ? 1 : s.ease(p);
    return { x: lerp(s.fx, s.tx, e), y: lerp(s.fy, s.ty, e), scale: lerp(s.fs, s.ts, e), opacity: lerp(s.fo, s.to, e) };
  }

  /** A state at rest at its target: full size and opaque. */
  private settled(item: T, mx: number, my: number): State<T> {
    return { item, fx: mx, fy: my, fs: 1, fo: 1, tx: mx, ty: my, ts: 1, to: 1, t0: 0, dur: 0, ease: linear, leaving: false };
  }

  /**
   * Start a new segment at `now` from the current state. Left alone when the item is already heading to that
   * target (or is there and at rest), so a stream of pan updates cannot keep restarting a fade that is under way.
   */
  private aim(s: State<T>, now: number, x: number, y: number, scale: number, opacity: number, dur: number, ease: Easing): void {
    const cur = this.current(s, now);
    const atRest = this.progress(s, now) >= 1;
    const there = (a: number, b: number, c: number, d: number) =>
      Math.abs(a - x) < EPS && Math.abs(b - y) < EPS && Math.abs(c - scale) < EPS && Math.abs(d - opacity) < EPS;
    if (atRest ? there(cur.x, cur.y, cur.scale, cur.opacity) : there(s.tx, s.ty, s.ts, s.to)) return;
    s.fx = cur.x; s.fy = cur.y; s.fs = cur.scale; s.fo = cur.opacity;
    s.tx = x; s.ty = y; s.ts = scale; s.to = opacity;
    s.t0 = now;
    s.dur = dur;
    s.ease = ease;
  }

  private durationFor(mode: AnimMode): number {
    switch (mode) {
      case "split": return SPLIT_MS;
      case "merge": return MERGE_MS;
      case "pan": return PAN_MS;
      case "reduced": return REDUCED_MS;
      default: return CROSSFADE_MS;
    }
  }

  private easeFor(mode: AnimMode): Easing {
    return mode === "split" ? easeOutCubic : mode === "merge" ? easeInCubic : linear;
  }
}
