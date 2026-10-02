import { describe, expect, it } from "vitest";
import { HIT_RADIUS, HitIndex, HitTester, MIN_HIT_OPACITY, hitTestLinear, type HitCandidate } from "@/map/hit-test/hit-test";

const logo = (key: string, x: number, y: number, extra: Partial<HitCandidate> = {}): HitCandidate => ({ key, kind: "logo", x, y, radius: 20, ...extra });
const cluster = (key: string, x: number, y: number, extra: Partial<HitCandidate> = {}): HitCandidate => ({ key, kind: "cluster", x, y, radius: 24, ...extra });

describe("hit radius", () => {
  it("is 44 px for touch and 24 px for a mouse, but never less than the drawn radius", () => {
    expect(HIT_RADIUS).toEqual({ touch: 44, mouse: 24 });
    const items = [logo("o:1", 100, 100)];
    expect(hitTestLinear(items, 100 + 30, 100, "mouse")).toBeNull();
    expect(hitTestLinear(items, 100 + 30, 100, "touch")?.key).toBe("o:1");
    expect(hitTestLinear(items, 100 + 45, 100, "touch")).toBeNull();
    // A cluster larger than the mouse radius is hit anywhere on its disc.
    const big = [cluster("c:1", 0, 0, { radius: 32 })];
    expect(hitTestLinear(big, 31, 0, "mouse")?.key).toBe("c:1");
    expect(hitTestLinear(big, 33, 0, "mouse")).toBeNull();
    const huge = [cluster("c:2", 0, 0, { radius: 60 })];
    expect(hitTestLinear(huge, 59, 0, "mouse")?.key).toBe("c:2");
  });

  it("returns null for no markers", () => {
    expect(hitTestLinear([], 5, 5, "touch")).toBeNull();
    expect(new HitIndex([]).query(5, 5, "touch")).toBeNull();
  });
});

describe("overlap order (map-spec §6)", () => {
  it("rule 1: the selected marker wins over a cluster, which is otherwise drawn above a logo", () => {
    const items = [cluster("c:1", 100, 100), logo("o:1", 100, 100, { selected: true })];
    expect(hitTestLinear(items, 100, 100, "mouse")?.key).toBe("o:1");
  });

  it("rule 2: a cluster is above a logo or a stack, whatever the keys, distances, and listing order", () => {
    const a = [logo("o:1", 100, 100), cluster("c:9", 112, 100)]; // the logo's centre is nearer the point
    const b = [...a].reverse();
    for (const items of [a, b]) expect(hitTestLinear(items, 100, 100, "mouse")?.key).toBe("c:9");
    const stack: HitCandidate = { key: "s:o:1", kind: "stack", x: 100, y: 100, radius: 20 };
    expect(hitTestLinear([stack, cluster("c:5", 100, 100)], 100, 100, "mouse")?.key).toBe("c:5");
  });

  it("rule 3: with equal rank, the nearest centre wins", () => {
    const a = [logo("o:1", 100, 100), logo("o:2", 118, 100)];
    expect(hitTestLinear(a, 101, 100, "mouse")?.key).toBe("o:1");
    expect(hitTestLinear(a, 112, 100, "mouse")?.key).toBe("o:2");
    expect(hitTestLinear([...a].reverse(), 101, 100, "mouse")?.key).toBe("o:1");
  });

  it("rule 4: on an exact tie, the lowest key wins, in either listing order", () => {
    const items = [logo("o:9", 100, 100), logo("o:10", 100, 100), logo("o:2", 100, 100)];
    expect(hitTestLinear(items, 100, 100, "touch")?.key).toBe("o:10"); // lexical: "o:10" < "o:2" < "o:9"
    expect(hitTestLinear([...items].reverse(), 100, 100, "touch")?.key).toBe("o:10");
  });

  it("a tap on a marker beats a cluster that is reached only through the extra radius", () => {
    // The cluster's centre is 40 px away: inside the 44 px touch radius, outside its 24 px disc.
    const items = [logo("o:1", 100, 100), cluster("c:1", 140, 100)];
    expect(hitTestLinear(items, 100, 100, "touch")?.key).toBe("o:1");
    expect(hitTestLinear(items, 100, 100, "mouse")?.key).toBe("o:1");
  });

  it("when nothing is under the finger, the nearest edge wins, not the highest rank", () => {
    // A cluster 40 px from the tap with a 24 px radius (edge 16 px away); a logo 30 px away with a 20 px radius (edge 10 px).
    const items = [logo("o:1", 100, 70), cluster("c:1", 140, 100)];
    expect(hitTestLinear(items, 100, 100, "touch")?.key).toBe("o:1");
  });
});

describe("markers that are fading", () => {
  it("ignores a marker below the minimum opacity: it is not drawn under the finger", () => {
    // Both markers are at the same point, so the lower key wins whenever both count.
    const faint = (opacity: number) => [logo("o:1", 100, 100, { opacity }), logo("o:2", 100, 100)];
    expect(hitTestLinear(faint(MIN_HIT_OPACITY - 0.01), 100, 100, "mouse")?.key).toBe("o:2");
    expect(hitTestLinear(faint(MIN_HIT_OPACITY), 100, 100, "mouse")?.key).toBe("o:1");
  });

  it("answers null when everything under the point is fading out", () => {
    expect(hitTestLinear([logo("o:1", 100, 100, { opacity: 0.1 })], 100, 100, "touch")).toBeNull();
  });
});

/** A seeded generator, so a failure reproduces. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomFrame(seed: number, n: number): HitCandidate[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const isCluster = r() < 0.2;
    return {
      key: `${isCluster ? "c" : "o"}:${i}`,
      kind: isCluster ? ("cluster" as const) : ("logo" as const),
      x: r() * 600,
      y: r() * 400,
      radius: isCluster ? 18 + r() * 14 : 20,
      selected: r() < 0.02,
      opacity: r() < 0.1 ? r() * 0.4 : 1,
    };
  });
}

describe("index and linear scan agree", () => {
  it("on 3,000 random taps over 4 dense frames, for touch and mouse", () => {
    const r = rng(7);
    let hits = 0;
    for (const [frameIndex, n] of [150, 400, 400, 900].entries()) {
      const items = randomFrame(100 + frameIndex, n);
      const index = new HitIndex(items);
      for (let q = 0; q < 750; q++) {
        const x = r() * 640 - 20;
        const y = r() * 440 - 20;
        const pointer = q % 2 ? "touch" : "mouse";
        const expected = hitTestLinear(items, x, y, pointer);
        expect(index.query(x, y, pointer)?.key ?? null).toBe(expected?.key ?? null);
        if (expected) hits++;
      }
    }
    expect(hits).toBeGreaterThan(1500); // the frames are dense enough that most taps land on something
  });
});

describe("HitTester", () => {
  const settled = (items: HitCandidate[], frame: number) => ({ items, frame, animating: false });

  it("scans linearly while animating and uses the index once settled", () => {
    const tester = new HitTester();
    const items = [logo("o:1", 100, 100)];
    expect(tester.test({ items, frame: 1, animating: true }, 100, 100, "mouse")?.key).toBe("o:1");
    expect(tester.lastMethod).toBe("linear");
    expect(tester.builds).toBe(0);
    expect(tester.test(settled(items, 2), 100, 100, "mouse")?.key).toBe("o:1");
    expect(tester.lastMethod).toBe("index");
    expect(tester.builds).toBe(1);
  });

  it("builds the index once per drawn frame, not once per tap", () => {
    const tester = new HitTester();
    const items = [logo("o:1", 100, 100)];
    for (let i = 0; i < 10; i++) tester.test(settled(items, 5), 100 + i, 100, "mouse");
    expect(tester.builds).toBe(1);
    tester.test(settled(items, 6), 100, 100, "mouse");
    expect(tester.builds).toBe(2);
  });

  it("tests the positions of the frame it is given: a marker that moved is found where it is now", () => {
    const tester = new HitTester();
    const before = [logo("o:1", 100, 100)];
    const during = [logo("o:1", 180, 100)]; // mid-split: the same marker, further out
    expect(tester.test({ items: during, frame: 3, animating: true }, 100, 100, "mouse")).toBeNull();
    expect(tester.test({ items: during, frame: 3, animating: true }, 180, 100, "mouse")?.key).toBe("o:1");
    expect(tester.test({ items: before, frame: 2, animating: true }, 100, 100, "mouse")?.key).toBe("o:1");
  });
});
