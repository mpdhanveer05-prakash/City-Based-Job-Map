import { describe, expect, it } from "vitest";
import { TileFailureMonitor, checkWebGl2 } from "@/map/fallback";

describe("checkWebGl2", () => {
  it("is ok when a WebGL2 context can be made, and gives the context back", () => {
    let lost = false;
    const gl = { getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext: () => { lost = true; } } : null) };
    expect(checkWebGl2(() => ({ getContext: (type: string) => (type === "webgl2" ? gl : null) }) as never)).toEqual({ ok: true });
    expect(lost).toBe(true);
  });

  it("is not ok when the browser has no WebGL2, or throws while making one", () => {
    expect(checkWebGl2(() => ({ getContext: () => null }) as never)).toEqual({ ok: false, reason: "no-webgl2" });
    expect(
      checkWebGl2(() => ({ getContext: () => { throw new Error("blocked"); } }) as never),
    ).toEqual({ ok: false, reason: "no-webgl2" });
  });

  it("asks for webgl2 only, never falling back to webgl1 (the layer needs WebGL2)", () => {
    const asked: string[] = [];
    checkWebGl2(() => ({ getContext: (type: string) => { asked.push(type); return null; } }) as never);
    expect(asked).toEqual(["webgl2"]);
  });
});

describe("TileFailureMonitor", () => {
  it("does not complain about one or two dropped tiles", () => {
    const m = new TileFailureMonitor();
    expect(m.error(0)).toBe(false);
    expect(m.error(100)).toBe(false);
    expect(m.failing).toBe(false);
  });

  it("starts failing on the third error inside the window, once", () => {
    const m = new TileFailureMonitor();
    m.error(0);
    m.error(1_000);
    expect(m.error(2_000)).toBe(true);
    expect(m.failing).toBe(true);
    expect(m.error(3_000)).toBe(false); // already failing: no second banner
  });

  it("forgets errors that are older than the window", () => {
    const m = new TileFailureMonitor({ windowMs: 10_000 });
    m.error(0);
    m.error(1_000);
    expect(m.error(12_000)).toBe(false); // the first two are 11 s and 12 s old
    expect(m.failing).toBe(false);
  });

  it("clears on a good tile, and needs three new errors to fail again", () => {
    const m = new TileFailureMonitor();
    [0, 1, 2].forEach((t) => m.error(t));
    expect(m.failing).toBe(true);
    expect(m.loaded()).toBe(true);
    expect(m.failing).toBe(false);
    expect(m.loaded()).toBe(false); // nothing to clear
    expect(m.error(10)).toBe(false);
    expect(m.error(11)).toBe(false);
    expect(m.error(12)).toBe(true);
  });

  it("a good tile in between resets the count", () => {
    const m = new TileFailureMonitor();
    m.error(0);
    m.error(1);
    m.loaded();
    expect(m.error(2)).toBe(false);
    expect(m.error(3)).toBe(false);
    expect(m.failing).toBe(false);
  });
});
