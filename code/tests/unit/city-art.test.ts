import { describe, expect, it } from "vitest";
import { projectCity } from "@/lib/city-art";
import type { CityBoundary } from "@/lib/filters/dataset";

const square = (west: number, south: number, east: number, north: number): CityBoundary => ({
  type: "MultiPolygon",
  coordinates: [[[[west, south], [east, south], [east, north], [west, north], [west, south]]]],
});
const BOX = { width: 400, height: 240, padding: 20 };

function bounds(path: string) {
  const nums = [...path.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const xs = nums.map((n) => n[0]);
  const ys = nums.map((n) => n[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

describe("projectCity", () => {
  it("fits the boundary inside the box with the padding, and centres it", () => {
    const art = projectCity(square(77.45, 12.8, 77.8, 13.15), [], BOX);
    const b = bounds(art.path);
    expect(b.minX).toBeGreaterThanOrEqual(BOX.padding - 0.1);
    expect(b.maxX).toBeLessThanOrEqual(BOX.width - BOX.padding + 0.1);
    expect(b.minY).toBeGreaterThanOrEqual(BOX.padding - 0.1);
    expect(b.maxY).toBeLessThanOrEqual(BOX.height - BOX.padding + 0.1);
    // Centred on both axes.
    expect(Math.abs(b.minX + b.maxX - BOX.width)).toBeLessThan(0.3);
    expect(Math.abs(b.minY + b.maxY - BOX.height)).toBeLessThan(0.3);
  });

  it("can start at the left padding instead of centring", () => {
    const art = projectCity(square(10, 10, 11, 12), [], { ...BOX, align: "start" });
    expect(bounds(art.path).minX).toBeCloseTo(BOX.padding, 0);
    expect(bounds(art.path).maxX).toBeLessThan(BOX.width / 2);
  });

  it("keeps the real shape: a square degree box is narrower than tall in the north, by cos(latitude)", () => {
    const art = projectCity(square(80, 60, 81, 61), [], { width: 1000, height: 1000, padding: 0 });
    const b = bounds(art.path);
    expect((b.maxX - b.minX) / (b.maxY - b.minY)).toBeCloseTo(Math.cos((60.5 * Math.PI) / 180), 2);
  });

  it("puts north at the top and west at the left", () => {
    const art = projectCity(square(10, 10, 12, 12), [[10.1, 11.9], [11.9, 10.1]], BOX);
    const [northWest, southEast] = art.dots;
    expect(northWest[0]).toBeLessThan(southEast[0]);
    expect(northWest[1]).toBeLessThan(southEast[1]);
  });

  it("drops points outside the boundary's box", () => {
    const art = projectCity(square(10, 10, 12, 12), [[11, 11], [20, 20], [9, 11]], BOX);
    expect(art.dots).toHaveLength(1);
  });

  it("draws one closed sub-path per ring", () => {
    const two: CityBoundary = {
      type: "MultiPolygon",
      coordinates: [
        [[[0, 0], [1, 0], [1, 1], [0, 0]]],
        [[[2, 2], [3, 2], [3, 3], [2, 2]], [[2.2, 2.2], [2.4, 2.2], [2.4, 2.4], [2.2, 2.2]]],
      ],
    };
    const art = projectCity(two, [], BOX);
    expect(art.path.match(/M/g)).toHaveLength(3);
    expect(art.path.match(/Z/g)).toHaveLength(3);
  });

  it("returns nothing for an empty boundary instead of NaN", () => {
    const art = projectCity({ type: "MultiPolygon", coordinates: [] }, [[1, 1]], BOX);
    expect(art).toEqual({ path: "", dots: [] });
    expect(projectCity(square(1, 1, 2, 2), [], BOX).path).not.toContain("NaN");
  });
});
