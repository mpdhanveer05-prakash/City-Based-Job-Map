import { describe, expect, it } from "vitest";
import { MIN_MIRROR_OPACITY, mirrorEntries, neighbour, nextFocus, tabStop, type MirrorEntry } from "@/map/a11y-mirror";

const e = (key: string, x: number, y: number, extra: Partial<MirrorEntry> = {}): MirrorEntry => ({ key, kind: "logo", x, y, radius: 20, ...extra });
const BOUNDS = { width: 800, height: 600 };

describe("mirrorEntries", () => {
  it("lists only visible markers: inside the map and not fading", () => {
    const drawn = [
      e("o:1", 100, 100),
      e("o:2", -5, 100), // off the left edge (drawn in the culling margin)
      e("o:3", 400, 700), // below the map
      e("o:4", 300, 300, { opacity: MIN_MIRROR_OPACITY - 0.01 }),
      e("o:5", 300, 300, { opacity: MIN_MIRROR_OPACITY }),
    ];
    expect(mirrorEntries(drawn, BOUNDS).map((x) => x.key)).toEqual(["o:1", "o:5"]);
  });

  it("orders by reading order, whatever order the layer drew them in", () => {
    const drawn = [e("o:4", 600, 300), e("o:2", 500, 110), e("o:1", 100, 100), e("o:3", 50, 300)];
    const expected = ["o:1", "o:2", "o:3", "o:4"];
    expect(mirrorEntries(drawn, BOUNDS).map((x) => x.key)).toEqual(expected);
    expect(mirrorEntries([...drawn].reverse(), BOUNDS).map((x) => x.key)).toEqual(expected);
  });

  it("breaks an exact tie by key", () => {
    expect(mirrorEntries([e("o:9", 10, 10), e("o:10", 10, 10)], BOUNDS).map((x) => x.key)).toEqual(["o:10", "o:9"]);
  });

  it("is empty for an empty map", () => {
    expect(mirrorEntries([], BOUNDS)).toEqual([]);
  });
});

describe("neighbour (arrow keys)", () => {
  //   a(100,100)   b(300,100)
  //   c(100,300)   d(300,320)   f(500,300)
  const list = [e("a", 100, 100), e("b", 300, 100), e("c", 100, 300), e("d", 300, 320), e("f", 500, 300)];

  it("moves to the nearest marker in the direction pressed", () => {
    expect(neighbour(list, "a", "right")?.key).toBe("b");
    expect(neighbour(list, "a", "down")?.key).toBe("c");
    expect(neighbour(list, "d", "left")?.key).toBe("c");
    expect(neighbour(list, "d", "right")?.key).toBe("f");
    expect(neighbour(list, "d", "up")?.key).toBe("b");
  });

  it("prefers a marker straight ahead over a nearer one off to the side", () => {
    const l = [e("from", 100, 100), e("near-side", 130, 170), e("far-ahead", 300, 110)];
    expect(neighbour(l, "from", "right")?.key).toBe("far-ahead");
  });

  it("returns null at the edge, so focus stays put", () => {
    expect(neighbour(list, "a", "left")).toBeNull();
    expect(neighbour(list, "a", "up")).toBeNull();
    expect(neighbour(list, "f", "right")).toBeNull();
  });

  it("returns null for a key that is not listed, and for a single marker", () => {
    expect(neighbour(list, "zzz", "left")).toBeNull();
    expect(neighbour([e("only", 5, 5)], "only", "down")).toBeNull();
  });

  it("is reachable from anywhere: every marker can be reached from the first by arrow keys", () => {
    // Walk right/down greedily; every marker must be visited by some sequence of the four arrows.
    const seen = new Set<string>(["a"]);
    const queue = ["a"];
    while (queue.length) {
      const key = queue.pop()!;
      for (const d of ["up", "down", "left", "right"] as const) {
        const next = neighbour(list, key, d);
        if (next && !seen.has(next.key)) { seen.add(next.key); queue.push(next.key); }
      }
    }
    expect([...seen].sort()).toEqual(["a", "b", "c", "d", "f"]);
  });
});

describe("nextFocus", () => {
  const list = [e("a", 100, 100), e("b", 300, 100), e("c", 100, 300)];

  it("Home and End go to the first and last in reading order", () => {
    expect(nextFocus(list, "b", "Home")).toBe("a");
    expect(nextFocus(list, "a", "End")).toBe("c");
  });

  it("arrows move, and do nothing at an edge or for other keys", () => {
    expect(nextFocus(list, "a", "ArrowRight")).toBe("b");
    expect(nextFocus(list, "a", "ArrowLeft")).toBeNull();
    expect(nextFocus(list, "a", "x")).toBeNull();
  });

  it("an arrow with nothing focused (or a focused marker that has gone) starts at the first", () => {
    expect(nextFocus(list, null, "ArrowDown")).toBe("a");
    expect(nextFocus(list, "gone", "ArrowDown")).toBe("a");
  });

  it("does nothing on an empty map", () => {
    expect(nextFocus([], null, "ArrowDown")).toBeNull();
    expect(nextFocus([], null, "Home")).toBeNull();
  });
});

describe("tabStop", () => {
  const list = [e("a", 100, 100), e("b", 300, 100)];
  it("is the focused marker while it is listed, otherwise the first", () => {
    expect(tabStop(list, "b")).toBe("b");
    expect(tabStop(list, "gone")).toBe("a");
    expect(tabStop(list, null)).toBe("a");
    expect(tabStop([], "a")).toBeNull();
  });
});
