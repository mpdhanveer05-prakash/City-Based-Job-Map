// Co-location (map-spec §7): offices within 5 m of each other, or in the same building, are drawn as one stacked
// marker with a count badge. Pure and DOM-free.
//
// Supercluster clusters anything that overlaps up to zoom 17, so stacks only appear on the deepest level, where
// every office is its own item. `colocateResponse` rewrites that level's worker response: each group of offices
// becomes one stack, and the lineage the animator reads is rewritten with it.
import { KIND_CLUSTER, type ClusterResponse } from "../worker/protocol.ts";
import type { ResponseTarget } from "../animation/targets.ts";
import type { LayerItem } from "./instances.ts";

/** Offices this close are one stack (map-spec §7). */
export const CO_LOCATION_METERS = 5;
const METERS_PER_DEGREE = 111_320;

export type ColocatedPoint = {
  /** The office key, `o:<id>`. */
  key: string;
  companyId: number;
  lng: number;
  lat: number;
  /** Offices with the same building are one group wherever they sit. Optional: the data model has no buildings yet. */
  buildingId?: string | number | null;
};

export type ColocationGroup = {
  /** `s:<lowest member key>` for a stack of two or more companies; the lowest member's own key for one company. */
  key: string;
  /** Member office keys, sorted. */
  memberKeys: string[];
  /** The unique companies, sorted. */
  companyIds: number[];
  /** Unique companies. A stack is a group of at least 2. */
  count: number;
  /** The true position: the lowest-keyed member's, so identical coordinates stay exactly identical. */
  lng: number;
  lat: number;
};

const lexical = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Groups points that are within `meters` of one another (single linkage, so a chain of close points is one
 * group) or share a building. Only groups of two or more offices are returned. The result is deterministic:
 * independent of input order.
 */
export function groupColocated(points: readonly ColocatedPoint[], meters = CO_LOCATION_METERS): ColocationGroup[] {
  const n = points.length;
  if (n < 2) return [];
  const sorted = [...points].sort((a, b) => lexical(a.key, b.key));

  // Project to local planar metres around the mean latitude: exact enough at city scale and 5 m.
  const refLat = sorted.reduce((sum, p) => sum + p.lat, 0) / n;
  const refLng = sorted[0].lng;
  const kx = METERS_PER_DEGREE * Math.cos((refLat * Math.PI) / 180);
  const xs = sorted.map((p) => (p.lng - refLng) * kx);
  const ys = sorted.map((p) => (p.lat - sorted[0].lat) * METERS_PER_DEGREE);

  const parent = sorted.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); // the lowest index (lowest key) is the root
  };

  // A grid with cells `meters` wide: a close pair is always in the same or a neighbouring cell.
  const cells = new Map<string, number[]>();
  const cellOf = (v: number) => Math.floor(v / meters);
  const buildings = new Map<string | number, number>();
  sorted.forEach((p, i) => {
    const cx = cellOf(xs[i]);
    const cy = cellOf(ys[i]);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (Math.hypot(xs[i] - xs[j], ys[i] - ys[j]) <= meters) union(i, j);
        }
      }
    }
    const id = `${cx},${cy}`;
    (cells.get(id) ?? cells.set(id, []).get(id)!).push(i);
    if (p.buildingId != null) {
      const first = buildings.get(p.buildingId);
      if (first === undefined) buildings.set(p.buildingId, i);
      else union(i, first);
    }
  });

  const byRoot = new Map<number, number[]>();
  sorted.forEach((_, i) => {
    const root = find(i);
    (byRoot.get(root) ?? byRoot.set(root, []).get(root)!).push(i);
  });

  const groups: ColocationGroup[] = [];
  for (const members of byRoot.values()) {
    if (members.length < 2) continue;
    const companyIds = [...new Set(members.map((i) => sorted[i].companyId))].sort((a, b) => a - b);
    const first = sorted[members[0]];
    groups.push({
      key: companyIds.length >= 2 ? `s:${first.key}` : first.key,
      memberKeys: members.map((i) => sorted[i].key),
      companyIds,
      count: companyIds.length,
      lng: first.lng,
      lat: first.lat,
    });
  }
  return groups.sort((a, b) => lexical(a.memberKeys[0], b.memberKeys[0]));
}

/** What the last level-18 response collapsed: for rewriting the lineage of a zoom out, and for tapping a stack. */
export type StackMemo = {
  /** `dataVersion:filterHash` of the response it was built from. */
  namespace: string;
  /** Office key to the key it is drawn as (its stack, or the one logo kept for a one-company group). */
  drawnAs: Map<string, string>;
  /** The groups of two or more companies, by stack key. */
  stacks: Map<string, ColocationGroup>;
};

export const emptyStackMemo = (namespace = ""): StackMemo => ({ namespace, drawnAs: new Map(), stacks: new Map() });

export type ColocateOptions = {
  /** Builds the drawable for item `i` of the response: a cluster or a single office. */
  makeItem(index: number): LayerItem;
  /** Builds the stack marker for a group of two or more companies. */
  makeStack(group: ColocationGroup): LayerItem;
  /** `dataVersion:filterHash`. */
  namespace: string;
  /** Updated in place on the deepest level; read for the lineage on every other level. */
  memo: StackMemo;
  /** The deepest level, where offices are never clustered (the worker's MAX_LEVEL). */
  deepestLevel: number;
};

/**
 * Animator targets for a worker response, with co-located offices collapsed into stacks.
 *
 * On the deepest level the offices are grouped; each group becomes one target whose parent is the cluster that
 * held its first member. On every level, a cluster's children are rewritten through the memo, so zooming out
 * from a stack merges the stack into its cluster instead of fading it in place.
 */
export function colocateResponse(response: ClusterResponse, options: ColocateOptions): Array<ResponseTarget<LayerItem>> {
  const { memo, namespace } = options;
  const childrenOf = (i: number) => response.childKeys.slice(response.childOffsets[i], response.childOffsets[i + 1]);

  const officeIndex = new Map<string, number>();
  const points: ColocatedPoint[] = [];
  if (response.level >= options.deepestLevel) {
    response.keys.forEach((key, i) => {
      if (response.kinds[i] === KIND_CLUSTER) return;
      officeIndex.set(key, i);
      points.push({ key, companyId: response.companyIds[i], lng: response.lngLat[2 * i], lat: response.lngLat[2 * i + 1] });
    });
    memo.namespace = namespace;
    memo.drawnAs.clear();
    memo.stacks.clear();
  } else if (memo.namespace !== namespace) {
    memo.namespace = namespace;
    memo.drawnAs.clear();
    memo.stacks.clear();
  }

  const groups = groupColocated(points);
  const groupOf = new Map<string, ColocationGroup>();
  for (const group of groups) {
    for (const key of group.memberKeys) {
      groupOf.set(key, group);
      memo.drawnAs.set(key, group.key);
    }
    if (group.count >= 2) memo.stacks.set(group.key, group);
  }

  const emitted = new Set<string>();
  const targets: Array<ResponseTarget<LayerItem>> = [];
  response.keys.forEach((key, i) => {
    const group = groupOf.get(key);
    if (group) {
      if (emitted.has(group.key)) return;
      emitted.add(group.key);
      const first = officeIndex.get(group.memberKeys[0])!;
      targets.push({
        item: group.count >= 2 ? options.makeStack(group) : options.makeItem(first),
        parentKey: response.parentKeys[first],
        childKeys: [group.key],
      });
      return;
    }
    // A cluster lists the offices it splits into; a stack stands for several of them.
    const children = childrenOf(i).map((child) => memo.drawnAs.get(child) ?? child);
    targets.push({
      item: options.makeItem(i),
      parentKey: response.parentKeys[i],
      childKeys: [...new Set(children)],
    });
  });
  return targets;
}
