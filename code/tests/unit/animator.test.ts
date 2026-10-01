import { describe, expect, it } from "vitest";
import { Animator, type AnimOutput, type AnimTarget } from "@/map/animation/animator";
import { CROSSFADE_MS, MAX_MOVING, MERGE_MS, PAN_MS, REDUCED_MS, SPLIT_MS, easeInCubic, easeOutCubic, linear } from "@/map/animation/easing";

type Item = { key: string };

const target = (key: string, mx: number, my: number, parentKey = key, childKeys: string[] = [key]): AnimTarget<Item> => ({
  item: { key },
  mx,
  my,
  parentKey,
  childKeys,
});

const NS = "v1:f0";
const make = (options: ConstructorParameters<typeof Animator<Item>>[0] = { reducedMotion: () => false }) => new Animator<Item>(options);

function out(n: number): AnimOutput {
  return { x: new Float64Array(n), y: new Float64Array(n), scale: new Float32Array(n), opacity: new Float32Array(n) };
}

type Sample = { x: number; y: number; scale: number; opacity: number };

/** The state of every item on the render list at `now`, by key. */
function sampleAll(a: Animator<Item>, now: number): Map<string, Sample> {
  const o = out(a.size);
  a.sample(now, o);
  return new Map(a.items.map((it, i) => [it.key, { x: o.x[i], y: o.y[i], scale: o.scale[i], opacity: o.opacity[i] }]));
}

function at(a: Animator<Item>, key: string, now: number): Sample {
  const s = sampleAll(a, now).get(key);
  if (!s) throw new Error(`${key} is not on the render list`);
  return s;
}

/** Start with the given items settled at `t = 0`. */
function settled(items: Array<[string, number, number]>, level = 5, a = make()) {
  a.update({ generation: 1, level, namespace: NS, targets: items.map(([k, x, y]) => target(k, x, y)), now: 0 });
  // Let the first fade-in finish.
  expect(a.sample(CROSSFADE_MS, out(a.size))).toBe(false);
  return a;
}

describe("easing", () => {
  it("runs 0 to 1 with the intended shapes", () => {
    for (const f of [linear, easeOutCubic, easeInCubic]) {
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
    }
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 12); // fast at first
    expect(easeInCubic(0.5)).toBeCloseTo(0.125, 12); // slow at first
    expect(linear(0.3)).toBe(0.3);
  });

  it("uses 280 ms to split and 220 ms to merge", () => {
    expect(SPLIT_MS).toBe(280);
    expect(MERGE_MS).toBe(220);
  });
});

describe("first draw and panning", () => {
  it("fades the first scene in place", () => {
    const a = make();
    a.update({ generation: 1, level: 5, namespace: NS, targets: [target("a", 0.4, 0.5)], now: 1000 });
    expect(at(a, "a", 1000)).toEqual({ x: 0.4, y: 0.5, scale: 1, opacity: 0 });
    expect(at(a, "a", 1000 + CROSSFADE_MS / 2).opacity).toBeCloseTo(0.5, 6);
    expect(at(a, "a", 1000 + CROSSFADE_MS).opacity).toBe(1);
    expect(a.stats.mode).toBe("initial");
  });

  it("fades items in and out on a pan without moving them", () => {
    const a = settled([["a", 0.1, 0.1], ["b", 0.2, 0.2]]);
    a.update({ generation: 1, level: 5, namespace: NS, targets: [target("b", 0.2, 0.2), target("c", 0.3, 0.3)], now: 1000 });
    expect(a.stats.mode).toBe("pan");
    expect(at(a, "c", 1000)).toMatchObject({ x: 0.3, scale: 1, opacity: 0 });
    expect(at(a, "c", 1000 + PAN_MS).opacity).toBe(1);
    expect(at(a, "a", 1000 + PAN_MS / 2)).toMatchObject({ x: 0.1, y: 0.1, scale: 1 });
    expect(at(a, "a", 1000 + PAN_MS / 2).opacity).toBeCloseTo(0.5, 6);
    expect(at(a, "b", 1050)).toMatchObject({ opacity: 1 }); // a survivor does not flicker
  });

  it("does not restart a fade that is already under way when the next pan update repeats it", () => {
    const a = settled([["a", 0.1, 0.1]]);
    const targets = [target("a", 0.1, 0.1), target("c", 0.3, 0.3)];
    a.update({ generation: 1, level: 5, namespace: NS, targets, now: 1000 });
    a.update({ generation: 1, level: 5, namespace: NS, targets, now: 1060 }); // half way
    expect(at(a, "c", 1060).opacity).toBeCloseTo(0.5, 6);
    expect(at(a, "c", 1000 + PAN_MS).opacity).toBe(1); // still done on time
  });

  it("drops a finished fade-out from the render list at the next update", () => {
    const a = settled([["a", 0.1, 0.1], ["b", 0.2, 0.2]]);
    a.update({ generation: 1, level: 5, namespace: NS, targets: [target("b", 0.2, 0.2)], now: 1000 });
    expect(a.items.map((i) => i.key)).toEqual(["a", "b"]);
    a.update({ generation: 1, level: 5, namespace: NS, targets: [target("b", 0.2, 0.2)], now: 2000 });
    expect(a.items.map((i) => i.key)).toEqual(["b"]);
  });
});

describe("split (zooming in)", () => {
  // Cluster P at (0.5, 0.5) splits into C1 and C2.
  const split = () => {
    const a = settled([["P", 0.5, 0.5], ["Q", 0.9, 0.9]], 5);
    a.update({
      generation: 2,
      level: 6,
      namespace: NS,
      targets: [target("C1", 0.48, 0.5, "P"), target("C2", 0.52, 0.51, "P"), target("Q", 0.9, 0.9)],
      now: 1000,
    });
    return a;
  };

  it("starts each child at its parent, at no size and no opacity", () => {
    const a = split();
    expect(a.stats).toMatchObject({ mode: "split", moving: 2, degraded: false });
    expect(at(a, "C1", 1000)).toEqual({ x: 0.5, y: 0.5, scale: 0, opacity: 0 });
    expect(at(a, "C2", 1000)).toEqual({ x: 0.5, y: 0.5, scale: 0, opacity: 0 });
  });

  it("moves children to their own places over 280 ms, ease-out", () => {
    const a = split();
    const half = at(a, "C1", 1000 + SPLIT_MS / 2);
    // Ease-out: 87.5% of the way at half the time.
    expect(half.x).toBeCloseTo(0.5 + (0.48 - 0.5) * 0.875, 9);
    expect(half.scale).toBeCloseTo(0.875, 6);
    expect(half.opacity).toBeCloseTo(0.875, 6);
    expect(at(a, "C1", 1000 + SPLIT_MS)).toEqual({ x: 0.48, y: 0.5, scale: 1, opacity: 1 });
    expect(at(a, "C2", 1000 + SPLIT_MS)).toEqual({ x: 0.52, y: 0.51, scale: 1, opacity: 1 });
  });

  it("shrinks and fades the parent where it is", () => {
    const a = split();
    expect(at(a, "P", 1000)).toEqual({ x: 0.5, y: 0.5, scale: 1, opacity: 1 });
    const half = at(a, "P", 1000 + SPLIT_MS / 2);
    expect(half.x).toBe(0.5);
    expect(half.scale).toBeCloseTo(0.125, 6);
    expect(at(a, "P", 1000 + SPLIT_MS)).toEqual({ x: 0.5, y: 0.5, scale: 0, opacity: 0 });
  });

  it("leaves an unrelated survivor alone", () => {
    const a = split();
    expect(at(a, "Q", 1100)).toEqual({ x: 0.9, y: 0.9, scale: 1, opacity: 1 });
  });
});

describe("merge (zooming out)", () => {
  const merge = () => {
    const a = settled([["C1", 0.48, 0.5], ["C2", 0.52, 0.51], ["Q", 0.9, 0.9]], 6);
    a.update({
      generation: 2,
      level: 5,
      namespace: NS,
      targets: [target("P", 0.5, 0.505, "P", ["C1", "C2"]), target("Q", 0.9, 0.9)],
      now: 1000,
    });
    return a;
  };

  it("moves the children into the new cluster over 220 ms, ease-in, shrinking and fading", () => {
    const a = merge();
    expect(a.stats).toMatchObject({ mode: "merge", moving: 2 });
    expect(at(a, "C1", 1000)).toEqual({ x: 0.48, y: 0.5, scale: 1, opacity: 1 });
    const half = at(a, "C1", 1000 + MERGE_MS / 2);
    // Ease-in: only 12.5% of the way at half the time.
    expect(half.x).toBeCloseTo(0.48 + (0.5 - 0.48) * 0.125, 9);
    expect(half.scale).toBeCloseTo(1 - 0.125, 6);
    expect(at(a, "C1", 1000 + MERGE_MS)).toEqual({ x: 0.5, y: 0.505, scale: 0, opacity: 0 });
    expect(at(a, "C2", 1000 + MERGE_MS)).toMatchObject({ x: 0.5, y: 0.505, scale: 0, opacity: 0 });
  });

  it("grows the new cluster in at its own place", () => {
    const a = merge();
    expect(at(a, "P", 1000)).toEqual({ x: 0.5, y: 0.505, scale: 0, opacity: 0 });
    expect(at(a, "P", 1000 + MERGE_MS)).toEqual({ x: 0.5, y: 0.505, scale: 1, opacity: 1 });
  });
});

describe("retargeting from the current state", () => {
  it("never jumps when a zoom reverses mid-split", () => {
    const a = settled([["P", 0.5, 0.5]], 5);
    a.update({ generation: 2, level: 6, namespace: NS, targets: [target("C1", 0.4, 0.5, "P"), target("C2", 0.6, 0.5, "P")], now: 1000 });
    const before = sampleAll(a, 1100);
    // The user zooms back out 100 ms in: P returns, its children merge into it.
    a.update({ generation: 3, level: 5, namespace: NS, targets: [target("P", 0.5, 0.5, "P", ["C1", "C2"])], now: 1100 });
    const after = sampleAll(a, 1100);
    for (const key of ["C1", "C2", "P"]) {
      for (const f of ["x", "y", "scale", "opacity"] as const) {
        expect(after.get(key)![f], `${key}.${f}`).toBeCloseTo(before.get(key)![f], 9);
      }
    }
    // ...and then heads to the new place: the children end up on P, the returning P at full size.
    expect(at(a, "C1", 1100 + MERGE_MS)).toMatchObject({ x: 0.5, scale: 0, opacity: 0 });
    expect(at(a, "P", 1100 + MERGE_MS)).toEqual({ x: 0.5, y: 0.5, scale: 1, opacity: 1 });
  });

  it("reverses a fade-out when the item comes back", () => {
    const a = settled([["a", 0.1, 0.1]]);
    a.update({ generation: 1, level: 5, namespace: NS, targets: [], now: 1000 });
    const mid = at(a, "a", 1060).opacity;
    expect(mid).toBeCloseTo(0.5, 6);
    a.update({ generation: 1, level: 5, namespace: NS, targets: [target("a", 0.1, 0.1)], now: 1060 });
    expect(at(a, "a", 1060).opacity).toBeCloseTo(mid, 9);
    expect(at(a, "a", 1060 + PAN_MS).opacity).toBe(1);
  });

  it("keeps position, scale, and opacity continuous across random updates (property test)", () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let run = 0; run < 60; run++) {
      const a = make();
      let level = 5;
      let now = 0;
      let ns = 0;
      let generation = 1;
      let keys = Array.from({ length: 8 }, (_, i) => `k${i}`);
      a.update({ generation, level, namespace: `v${ns}`, targets: keys.map((k) => target(k, rand(), rand())), now });
      for (let step = 0; step < 14; step++) {
        now += rand() * 400; // sometimes mid-transition, sometimes after
        const before = sampleAll(a, now);
        const roll = rand();
        if (roll < 0.15) ns++;
        else if (roll < 0.55) level += 1;
        else if (roll < 0.85) level = Math.max(0, level - 1);
        // New keys for a new level or namespace, some old ones kept, some children of old ones.
        const next: string[] = keys.filter(() => rand() < 0.4);
        for (let j = 0; j < 1 + Math.floor(rand() * 6); j++) next.push(`n${run}-${step}-${j}`);
        const parents = keys.length ? keys : ["none"];
        const targets = next.map((k) => target(k, rand(), rand(), parents[Math.floor(rand() * parents.length)], rand() < 0.5 ? [k] : keys.slice(0, 2)));
        generation++;
        a.update({ generation, level, namespace: `v${ns}`, targets, now });
        const after = sampleAll(a, now);
        // Every item that was on the list keeps exactly the state it had at this instant.
        for (const [key, was] of before) {
          const is = after.get(key);
          if (!is) continue; // purged because it had already finished fading out
          for (const f of ["x", "y", "scale", "opacity"] as const) {
            expect(is[f], `run ${run} step ${step} ${key}.${f}`).toBeCloseTo(was[f], 9);
          }
        }
        expect(new Set(a.items.map((i) => i.key)).size).toBe(a.size); // a key is on the list once
        keys = next;
      }
    }
  });
});

describe("changing the filter or the data", () => {
  it("cross-fades: the old scene fades out where it is, the new one fades in where it is", () => {
    const a = settled([["c:v1:f0:7", 0.5, 0.5]], 5);
    a.update({ generation: 2, level: 5, namespace: "v1:f1", targets: [target("c:v1:f1:3", 0.52, 0.5)], now: 1000 });
    expect(a.stats).toMatchObject({ mode: "data", moving: 0 });
    expect(at(a, "c:v1:f0:7", 1000 + CROSSFADE_MS / 2)).toMatchObject({ x: 0.5, y: 0.5, scale: 1 });
    expect(at(a, "c:v1:f0:7", 1000 + CROSSFADE_MS / 2).opacity).toBeCloseTo(0.5, 6);
    expect(at(a, "c:v1:f1:3", 1000 + CROSSFADE_MS / 2)).toMatchObject({ x: 0.52, y: 0.5, scale: 1 });
    expect(at(a, "c:v1:f1:3", 1000 + CROSSFADE_MS).opacity).toBe(1);
  });

  it("cancels a split in flight without a jump", () => {
    const a = settled([["P", 0.5, 0.5]], 5);
    a.update({ generation: 2, level: 6, namespace: NS, targets: [target("C1", 0.4, 0.5, "P"), target("C2", 0.6, 0.5, "P")], now: 1000 });
    const before = sampleAll(a, 1140);
    a.update({ generation: 3, level: 6, namespace: "v1:f9", targets: [target("D1", 0.41, 0.5)], now: 1140 });
    const after = sampleAll(a, 1140);
    for (const key of ["P", "C1", "C2"]) expect(after.get(key)).toEqual(before.get(key));
    // The children stop heading for their places: they fade out where they are.
    expect(at(a, "C1", 1140 + CROSSFADE_MS)).toMatchObject({ x: before.get("C1")!.x, opacity: 0 });
    expect(at(a, "D1", 1140 + CROSSFADE_MS).opacity).toBe(1);
  });

  it("keeps an office that is in both result sets, with no flicker", () => {
    const a = settled([["o:5", 0.3, 0.3]], 12);
    a.update({ generation: 2, level: 12, namespace: "v1:f1", targets: [target("o:5", 0.3, 0.3)], now: 1000 });
    expect(a.stats.mode).toBe("data");
    expect(at(a, "o:5", 1050)).toEqual({ x: 0.3, y: 0.3, scale: 1, opacity: 1 });
  });

  it("cross-fades a jump of several levels, because no lineage links them", () => {
    const a = settled([["P", 0.5, 0.5]], 5);
    a.update({ generation: 2, level: 9, namespace: NS, targets: [target("X", 0.5, 0.5, "P")], now: 1000 });
    expect(a.stats.mode).toBe("jump");
    expect(at(a, "X", 1000)).toMatchObject({ x: 0.5, scale: 1, opacity: 0 });
  });
});

describe("generations", () => {
  it("ignores an update older than the latest one applied", () => {
    const a = settled([["a", 0.1, 0.1]]);
    a.update({ generation: 5, level: 5, namespace: NS, targets: [target("a", 0.1, 0.1), target("b", 0.2, 0.2)], now: 1000 });
    const applied = a.update({ generation: 4, level: 5, namespace: NS, targets: [target("z", 0.9, 0.9)], now: 1010 });
    expect(applied).toBe(false);
    expect(a.items.map((i) => i.key)).toEqual(["a", "b"]);
    expect(a.update({ generation: 5, level: 5, namespace: NS, targets: [target("a", 0.1, 0.1)], now: 1020 })).toBe(true); // same generation: a pan
  });
});

describe("limits and accessibility", () => {
  const manyChildren = (n: number) => Array.from({ length: n }, (_, i) => target(`C${i}`, 0.4 + i * 1e-4, 0.5, "P"));

  it("splits up to the limit with movement", () => {
    const a = settled([["P", 0.5, 0.5]], 5);
    a.update({ generation: 2, level: 6, namespace: NS, targets: manyChildren(MAX_MOVING), now: 1000 });
    expect(a.stats).toMatchObject({ mode: "split", moving: MAX_MOVING, degraded: false });
    expect(at(a, "C0", 1000).x).toBe(0.5);
  });

  it("cross-fades, and says so, above the limit", () => {
    const a = settled([["P", 0.5, 0.5]], 5);
    a.update({ generation: 2, level: 6, namespace: NS, targets: manyChildren(MAX_MOVING + 1), now: 1000 });
    expect(a.stats).toMatchObject({ mode: "degraded", moving: 0, degraded: true });
    // Children appear where they are, not at the parent.
    expect(at(a, "C0", 1000)).toMatchObject({ x: 0.4, scale: 1, opacity: 0 });
    expect(at(a, "C0", 1000 + CROSSFADE_MS).opacity).toBe(1);
    expect(at(a, "P", 1000)).toMatchObject({ x: 0.5, scale: 1 });
  });

  it("honours a custom limit", () => {
    const a = settled([["P", 0.5, 0.5]], 5, make({ maxMoving: 2, reducedMotion: () => false }));
    a.update({ generation: 2, level: 6, namespace: NS, targets: manyChildren(3), now: 1000 });
    expect(a.stats.degraded).toBe(true);
  });

  it("under reduced motion only fades, for at most 100 ms, and nothing moves or scales", () => {
    const a = settled([["P", 0.5, 0.5]], 5, make({ reducedMotion: () => true }));
    a.update({ generation: 2, level: 6, namespace: NS, targets: [target("C1", 0.4, 0.5, "P"), target("C2", 0.6, 0.5, "P")], now: 1000 });
    expect(a.stats).toMatchObject({ mode: "reduced", moving: 0 });
    expect(REDUCED_MS).toBeLessThanOrEqual(100);
    for (const t of [1000, 1030, 1070, 1000 + REDUCED_MS]) {
      for (const key of ["C1", "C2", "P"]) expect(at(a, key, t).scale, `${key} at ${t}`).toBe(1);
    }
    expect(at(a, "C1", 1000)).toMatchObject({ x: 0.4, opacity: 0 }); // already in its place
    expect(at(a, "C1", 1000 + REDUCED_MS).opacity).toBe(1);
    expect(at(a, "P", 1000 + REDUCED_MS).opacity).toBe(0);
  });

  it("reads the setting at each update", () => {
    let reduced = false;
    const a = make({ reducedMotion: () => reduced });
    a.update({ generation: 1, level: 5, namespace: NS, targets: [target("P", 0.5, 0.5)], now: 0 });
    reduced = true;
    a.update({ generation: 2, level: 6, namespace: NS, targets: [target("C", 0.4, 0.5, "P")], now: 1000 });
    expect(a.stats.mode).toBe("reduced");
  });
});

describe("sampling", () => {
  it("reports whether anything is still moving", () => {
    const a = settled([["P", 0.5, 0.5]]);
    a.update({ generation: 2, level: 6, namespace: NS, targets: [target("C", 0.4, 0.5, "P")], now: 1000 });
    const o = out(a.size);
    expect(a.sample(1100, o)).toBe(true);
    expect(a.sample(1000 + SPLIT_MS, o)).toBe(false);
  });

  it("writes in the caller's order", () => {
    const a = settled([["a", 0.1, 0.1], ["b", 0.2, 0.2], ["c", 0.3, 0.3]]);
    const o = out(3);
    a.sample(1000, o, [2, 0, 1]); // slot 0 is c, slot 1 is a, slot 2 is b
    expect(Array.from(o.x).map((v) => +v.toFixed(2))).toEqual([0.3, 0.1, 0.2]);
  });

  it("applies an instant reset with no transition", () => {
    const a = make();
    a.reset({ generation: 3, level: 8, namespace: NS, targets: [target("a", 0.1, 0.1), target("b", 0.2, 0.2)] });
    expect(at(a, "a", 0)).toEqual({ x: 0.1, y: 0.1, scale: 1, opacity: 1 });
    expect(a.sample(0, out(2))).toBe(false);
    // The next update continues from the reset scene as a normal zoom.
    a.update({ generation: 4, level: 9, namespace: NS, targets: [target("c", 0.1, 0.1, "a")], now: 5 });
    expect(a.stats.mode).toBe("split");
  });
});
