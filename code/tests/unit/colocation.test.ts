import { describe, expect, it } from "vitest";
import { Animator } from "@/map/animation/animator";
import { generateSyntheticDataset } from "@/map/fixtures/generate";
import {
  CO_LOCATION_METERS,
  colocateResponse,
  emptyStackMemo,
  groupColocated,
  type ColocatedPoint,
  type StackMemo,
} from "@/map/layer/colocation";
import { latToMercatorY, lngToMercatorX } from "@/map/layer/geometry";
import type { LayerItem } from "@/map/layer/instances";
import { createClusterEngine } from "@/map/worker/cluster-engine";
import { KIND_CLUSTER, MAX_LEVEL, packPointSet, type BBox } from "@/map/worker/protocol";

const BASE = { lng: 77.6, lat: 12.97 };
const M_PER_DEG = 111_320;
/** `meters` north of the base point. */
const north = (meters: number) => ({ lng: BASE.lng, lat: BASE.lat + meters / M_PER_DEG });
const pt = (id: number, company: number, at = BASE, extra: Partial<ColocatedPoint> = {}): ColocatedPoint => ({ key: `o:${id}`, companyId: company, ...at, ...extra });

describe("groupColocated", () => {
  it("groups identical coordinates, and names the stack after its lowest key", () => {
    const [group, ...rest] = groupColocated([pt(7, 70), pt(3, 30), pt(5, 50)]);
    expect(rest).toEqual([]);
    expect(group.key).toBe("s:o:3");
    expect(group.memberKeys).toEqual(["o:3", "o:5", "o:7"]);
    expect(group.companyIds).toEqual([30, 50, 70]);
    expect(group.count).toBe(3);
    expect(group.lng).toBe(BASE.lng); // exactly the members' coordinates, not a mean that may drift
    expect(group.lat).toBe(BASE.lat);
  });

  it("uses 5 m as the limit: 4.9 m is one group, 5.1 m is two points", () => {
    expect(CO_LOCATION_METERS).toBe(5);
    expect(groupColocated([pt(1, 1), pt(2, 2, north(4.9))])).toHaveLength(1);
    expect(groupColocated([pt(1, 1), pt(2, 2, north(5.1))])).toEqual([]);
  });

  it("links a chain of close points into one group (single linkage)", () => {
    const chain = [0, 4, 8, 12].map((m, i) => pt(i + 1, i + 1, north(m)));
    const groups = groupColocated(chain);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberKeys).toEqual(["o:1", "o:2", "o:3", "o:4"]);
  });

  it("finds pairs across a grid-cell boundary", () => {
    // 4.9 m apart, straddling the edge of a 5 m cell whichever way the grid falls.
    for (let offset = 0; offset < 5; offset += 0.7) {
      expect(groupColocated([pt(1, 1, north(offset)), pt(2, 2, north(offset + 4.9))]), `offset ${offset}`).toHaveLength(1);
    }
  });

  it("groups offices in the same building wherever they sit", () => {
    const a = pt(1, 1, BASE, { buildingId: "b1" });
    const b = pt(2, 2, north(40), { buildingId: "b1" });
    const c = pt(3, 3, north(80), { buildingId: "b2" });
    const groups = groupColocated([a, b, c]);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberKeys).toEqual(["o:1", "o:2"]);
  });

  it("does not make a stack of one company: a group with one company keeps its lowest office's key", () => {
    const [group] = groupColocated([pt(4, 9), pt(2, 9)]);
    expect(group.count).toBe(1);
    expect(group.key).toBe("o:2");
    expect(group.memberKeys).toEqual(["o:2", "o:4"]);
  });

  it("leaves isolated points alone, and handles none and one", () => {
    expect(groupColocated([])).toEqual([]);
    expect(groupColocated([pt(1, 1)])).toEqual([]);
    expect(groupColocated([pt(1, 1), pt(2, 2, north(60)), pt(3, 3, north(120))])).toEqual([]);
  });

  it("gives the same groups whatever order the points come in", () => {
    const points = [pt(1, 1), pt(2, 2), pt(3, 3, north(3)), pt(4, 4, north(50)), pt(5, 5, north(52)), pt(6, 6, north(500))];
    const expected = groupColocated(points);
    expect(expected.map((g) => g.memberKeys)).toEqual([["o:1", "o:2", "o:3"], ["o:4", "o:5"]]);
    for (const shuffled of [[...points].reverse(), [points[3], points[0], points[5], points[2], points[4], points[1]]]) {
      expect(groupColocated(shuffled)).toEqual(expected);
    }
  });

  it("finds exactly the synthetic co-location cases: 50 identical, 10 near, and the 30-company building", () => {
    const dataset = generateSyntheticDataset({ city: "bengaluru", size: "S" });
    const groups = groupColocated(dataset.offices.map((o) => pt(o.id, o.companyId, { lng: o.lng, lat: o.lat })));
    const byMembers = new Map(groups.map((g) => [g.memberKeys.join(","), g]));
    for (const fixture of dataset.groups) {
      const keys = fixture.officeIds.map((id) => `o:${id}`).sort().join(",");
      const found = byMembers.get(keys);
      expect(found, fixture.id).toBeDefined();
      expect(found!.count, fixture.id).toBe(fixture.officeIds.length); // each office is its own company
    }
    // Nothing else: the scattered offices are far enough apart that no random pair joins a group.
    expect(groups).toHaveLength(dataset.groups.length);
  });
});

// The worker's deepest level, with the synthetic co-location cases in it.
const WORLD: BBox = [-180, -85, 180, 85];
const dataset = generateSyntheticDataset({ city: "bengaluru", size: "S" });
const NS = { dataVersion: "t", filterHash: "all" };
const namespace = "t:all";

function engineFor(points = dataset.offices, ns = NS) {
  const engine = createClusterEngine();
  engine.load(packPointSet(points.map((o) => ({ id: o.id, companyId: o.companyId, lng: o.lng, lat: o.lat })), ns), 1);
  return engine;
}

const itemFor = (response: ReturnType<ReturnType<typeof engineFor>["getClusters"]>) => (i: number): LayerItem => ({
  key: response.keys[i],
  kind: response.kinds[i] === KIND_CLUSTER ? "cluster" : "logo",
  lng: response.lngLat[2 * i],
  lat: response.lngLat[2 * i + 1],
  count: response.companyCounts[i],
});

function colocated(response: ReturnType<ReturnType<typeof engineFor>["getClusters"]>, memo: StackMemo, ns = namespace) {
  return colocateResponse(response, {
    makeItem: itemFor(response),
    makeStack: (group) => ({ key: group.key, kind: "stack", lng: group.lng, lat: group.lat, count: group.count }),
    namespace: ns,
    memo,
    deepestLevel: MAX_LEVEL,
  });
}

describe("colocateResponse", () => {
  const engine = engineFor();
  const deep = engine.getClusters(WORLD, MAX_LEVEL, 1);

  it("replaces each group of offices with one stack and keeps every other office as it was", () => {
    const memo = emptyStackMemo();
    const targets = colocated(deep, memo);
    const keys = targets.map((t) => t.item.key);
    expect(new Set(keys).size).toBe(keys.length); // a key is drawn once

    const grouped = dataset.groups.flatMap((g) => g.officeIds.map((id) => `o:${id}`));
    for (const key of grouped) expect(keys).not.toContain(key); // members are inside their stack
    expect(targets.filter((t) => t.item.kind === "stack")).toHaveLength(dataset.groups.length);
    expect(targets).toHaveLength(deep.keys.length - grouped.length + dataset.groups.length);

    const building = dataset.groups.find((g) => g.kind === "building")!;
    const stack = targets.find((t) => t.item.key === `s:${building.officeIds.map((id) => `o:${id}`).sort()[0]}`)!;
    expect(stack.item.kind).toBe("stack");
    expect(stack.item.count).toBe(30);
    expect(stack.childKeys).toEqual([stack.item.key]);
    expect(stack.parentKey.startsWith("c:t:all:")).toBe(true); // the cluster that held the group one level out
    expect(memo.stacks.size).toBe(dataset.groups.length);
  });

  it("is deterministic for the same response", () => {
    const a = colocated(deep, emptyStackMemo()).map((t) => [t.item.key, t.parentKey]);
    const b = colocated(deep, emptyStackMemo()).map((t) => [t.item.key, t.parentKey]);
    expect(b).toEqual(a);
  });

  it("rewrites a cluster's children through the stacks, so zooming out merges a stack into its cluster", () => {
    const memo = emptyStackMemo();
    colocated(deep, memo);
    const shallow = engine.getClusters(WORLD, MAX_LEVEL - 1, 1);
    const targets = colocated(shallow, memo);
    const stackKeys = new Set(memo.stacks.keys());
    const memberKeys = new Set([...memo.stacks.values()].flatMap((g) => g.memberKeys));
    const childKeys = targets.flatMap((t) => t.childKeys);
    for (const key of memberKeys) expect(childKeys, `${key} is inside a stack`).not.toContain(key);
    for (const key of stackKeys) expect(childKeys, key).toContain(key);
    // No child is listed twice for one cluster.
    for (const t of targets) expect(new Set(t.childKeys).size).toBe(t.childKeys.length);
  });

  it("makes the animator merge stacks into their clusters (and fade them in place without the rewrite)", () => {
    const toAnim = (targets: ReturnType<typeof colocated>) =>
      targets.map((t) => ({ ...t, mx: lngToMercatorX(t.item.lng), my: latToMercatorY(t.item.lat) }));
    const run = (rewrite: boolean) => {
      const memo = emptyStackMemo();
      const deepTargets = colocated(deep, memo);
      const animator = new Animator<LayerItem>({ reducedMotion: () => false, maxMoving: 10_000 });
      animator.reset({ generation: 1, level: MAX_LEVEL, namespace, targets: toAnim(deepTargets) });
      const shallow = engine.getClusters(WORLD, MAX_LEVEL - 1, 2);
      animator.update({ generation: 2, level: MAX_LEVEL - 1, namespace, targets: toAnim(colocated(shallow, rewrite ? memo : emptyStackMemo(namespace))), now: 0 });
      return animator.stats;
    };
    const withRewrite = run(true);
    const without = run(false);
    expect(withRewrite.mode).toBe("merge");
    // Every group of 2+ companies is a stack that now travels into its cluster.
    expect(withRewrite.moving - without.moving).toBeGreaterThanOrEqual(dataset.groups.length);
  });

  it("forgets the stacks when the data changes (a new namespace), so old keys never leak into new lineage", () => {
    const memo = emptyStackMemo();
    colocated(deep, memo);
    expect(memo.stacks.size).toBeGreaterThan(0);
    const other = engineFor(dataset.offices.slice(0, 40), { dataVersion: "t", filterHash: "few" });
    const response = other.getClusters(WORLD, MAX_LEVEL - 1, 1);
    colocated(response, memo, "t:few");
    expect(memo.namespace).toBe("t:few");
    expect(memo.stacks.size).toBe(0);
    expect(memo.drawnAs.size).toBe(0);
  });
});
