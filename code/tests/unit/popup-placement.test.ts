import { describe, expect, it } from "vitest";
import { POPUP_GAP, distanceToPopup, placeSheet, placePopup, type MarkerDisc, type Rect, type Size } from "@/map/popup-placement";

const AREA: Rect = { left: 0, top: 0, right: 1200, bottom: 800 };
const SIZE: Size = { width: 320, height: 220 };
const marker = (x: number, y: number, radius = 20): MarkerDisc => ({ x, y, radius });

const rect = (p: { left: number; top: number }) => ({ left: p.left, top: p.top, right: p.left + SIZE.width, bottom: p.top + SIZE.height });
const within = (r: Rect, area: Rect) => r.left >= area.left && r.top >= area.top && r.right <= area.right && r.bottom <= area.bottom;

describe("desktop popup placement", () => {
  it("prefers the right-hand side, 12 px from the marker", () => {
    const p = placePopup(marker(400, 400), SIZE, AREA);
    expect(p.side).toBe("right");
    expect(POPUP_GAP).toBe(12);
    expect(p.left).toBe(400 + 20 + 12);
    expect(p.top).toBe(400 - 110); // centred on the marker
    expect(p.pan).toEqual({ dx: 0, dy: 0 });
  });

  it("falls back to left, then above, then below, in that order", () => {
    expect(placePopup(marker(1100, 400), SIZE, AREA).side).toBe("left");
    // Too close to the right and the left edge for a side popup, with room above:
    const narrow: Rect = { left: 0, top: 0, right: 400, bottom: 800 };
    expect(placePopup(marker(200, 600), SIZE, narrow).side).toBe("above");
    // ...and with no room above, below:
    expect(placePopup(marker(200, 100), SIZE, narrow).side).toBe("below");
  });

  it("never overlaps the marker, and keeps the 12 px gap, wherever the marker is", () => {
    for (let x = 0; x <= 1200; x += 75) {
      for (let y = 0; y <= 800; y += 50) {
        const m = marker(x, y);
        const p = placePopup(m, SIZE, AREA);
        // After the pan the marker is at (x + dx, y + dy); the popup is placed for that position.
        const moved = { ...m, x: m.x + p.pan.dx, y: m.y + p.pan.dy };
        expect(distanceToPopup(moved, p.left, p.top, SIZE), `marker at ${x},${y}`).toBeGreaterThanOrEqual(m.radius + 12 - 1e-6);
        expect(within(rect(p), AREA), `popup for ${x},${y} is inside the visible area`).toBe(true);
      }
    }
  });

  it("does not use a side popup that has been pulled so far that it no longer points at the marker", () => {
    // The marker is below the visible area (under the attribution): a right-hand popup pulled up into the area would
    // sit beside nothing, so the popup goes above it instead.
    const area: Rect = { left: 0, top: 0, right: 1200, bottom: 300 };
    const p = placePopup(marker(600, 310), SIZE, area);
    expect(p.side).toBe("above");
    expect(p.top + SIZE.height).toBeLessThanOrEqual(310 - 20 - 12 + 1e-9);
  });

  it("when nothing fits, eases the map so the marker sits where the right-hand popup fits", () => {
    const tight: Rect = { left: 0, top: 0, right: 420, bottom: 300 };
    const m = marker(210, 150);
    const p = placePopup(m, SIZE, tight);
    expect(p.side).toBe("right");
    expect(p.pan.dx).toBeLessThan(0); // the map moves left, so the marker has room to its right
    const moved = { ...m, x: m.x + p.pan.dx, y: m.y + p.pan.dy };
    expect(moved.x - moved.radius).toBeGreaterThanOrEqual(tight.left); // still fully on screen
    expect(within(rect(p), tight)).toBe(true);
    expect(p.left).toBe(moved.x + moved.radius + 12);
  });

  it("respects an area that excludes the list panel and the map controls", () => {
    const area: Rect = { left: 360, top: 0, right: 1160, bottom: 800 }; // a 360 px list on the left, controls on the right
    const p = placePopup(marker(380, 400), SIZE, area);
    expect(p.left).toBeGreaterThanOrEqual(360);
    expect(within(rect(p), area)).toBe(true);
  });
});

describe("mobile bottom sheet", () => {
  it("pads the map by the sheet's height and centres the marker in what is left", () => {
    const viewport = { width: 412, height: 915 };
    const s = placeSheet(marker(100, 700), viewport); // peek: 30%
    expect(s.height).toBe(Math.round(915 * 0.3));
    expect(s.paddingBottom).toBe(s.height);
    const visible = viewport.height - s.height;
    expect(100 + s.pan.dx).toBeCloseTo(viewport.width / 2, 6);
    expect(700 + s.pan.dy).toBeCloseTo(visible / 2, 6);
  });

  it("an expanded sheet is 60% of the screen", () => {
    expect(placeSheet(marker(0, 0), { width: 400, height: 1000 }, 0.6).height).toBe(600);
  });
});
