import { MessageChannel } from "node:worker_threads";
import { expose, releaseProxy, wrap } from "comlink";
import Supercluster from "supercluster";
import { describe, expect, it } from "vitest";
import { generateSyntheticDataset } from "@/map/fixtures/generate";
import { createClusterEngine, levelForZoom } from "@/map/worker/cluster-engine";
import { createClusterClient } from "@/map/worker/client";
import {
  CLUSTER_OPTIONS,
  KIND_CLUSTER,
  MAX_LEVEL,
  MIN_LEVEL,
  packPointSet,
  type AsyncClusterApi,
  type BBox,
  type ClusterResponse,
  type ClusterWorkerApi,
} from "@/map/worker/protocol";
import { createClusterWorkerApi } from "@/map/worker/worker-api";

const WORLD: BBox = [-180, -85, 180, 85];
const NS = { dataVersion: "test", filterHash: "f0" };

const dataset = generateSyntheticDataset({ city: "bengaluru", size: "S" });
const offices = dataset.offices.map((o) => ({ id: o.id, companyId: o.companyId, lng: o.lng, lat: o.lat }));
const companyOfOffice = new Map(offices.map((o) => [o.id, o.companyId]));
const levels = Array.from({ length: MAX_LEVEL - MIN_LEVEL + 1 }, (_, i) => MIN_LEVEL + i);

/** Independent index with the same settings, to count leaves without trusting the engine. */
const reference = new Supercluster<{ company: number }>({ ...CLUSTER_OPTIONS }).load(
  offices.map((o) => ({
    type: "Feature" as const,
    id: o.id,
    properties: { company: o.companyId },
    geometry: { type: "Point" as const, coordinates: [o.lng, o.lat] },
  })),
);
const leavesOf = (key: string): number[] =>
  key.startsWith("o:")
    ? [Number(key.slice(2))]
    : reference.getLeaves(Number(key.split(":").at(-1)), Infinity).map((f) => f.id as number);

function loadedEngine(points = offices, ns = NS) {
  const engine = createClusterEngine();
  engine.load(packPointSet(points, ns), 1);
  return engine;
}

const childrenOf = (r: ClusterResponse, i: number) => r.childKeys.slice(r.childOffsets[i], r.childOffsets[i + 1]);

/** A few viewports: a corner, the middle, and a thin strip, all inside Bengaluru's extent. */
function viewports(): BBox[] {
  const lngs = offices.map((o) => o.lng);
  const lats = offices.map((o) => o.lat);
  const [w, e, s, n] = [Math.min(...lngs), Math.max(...lngs), Math.min(...lats), Math.max(...lats)];
  const [mx, my] = [(w + e) / 2, (s + n) / 2];
  const [dx, dy] = [(e - w) / 5, (n - s) / 5];
  return [
    [w, s, mx, my],
    [mx - dx, my - dy, mx + dx, my + dy],
    [mx, my, e, n],
    [w, my - dy / 4, e, my + dy / 4],
  ];
}

describe("lineage invariants (whole city, every level)", () => {
  const engine = loadedEngine();
  const byLevel = new Map(levels.map((level) => [level, engine.getClusters(WORLD, level, 1)]));

  it("answers from the tree it reports", () => {
    for (const level of levels) expect(byLevel.get(level)!.level).toBe(level);
    expect(levelForZoom(-3)).toBe(MIN_LEVEL);
    expect(levelForZoom(7.9)).toBe(7);
    expect(levelForZoom(40)).toBe(MAX_LEVEL);
  });

  it("lists every office exactly once at every level", () => {
    for (const level of levels) {
      const r = byLevel.get(level)!;
      expect(new Set(r.keys).size).toBe(r.keys.length);
      expect(r.officeCounts.reduce((a, b) => a + b, 0)).toBe(offices.length);
    }
    expect(byLevel.get(MAX_LEVEL)!.keys).toHaveLength(offices.length);
  });

  it("makes the children of X at level + 1 report X as their parent", () => {
    for (const level of levels.slice(0, -1)) {
      const here = byLevel.get(level)!;
      const next = byLevel.get(level + 1)!;
      const nextIndex = new Map(next.keys.map((k, i) => [k, i]));
      here.keys.forEach((key, i) => {
        for (const child of childrenOf(here, i)) {
          const at = nextIndex.get(child);
          expect(at, `${child} (child of ${key}) is missing at level ${level + 1}`).toBeDefined();
          expect(next.parentKeys[at!]).toBe(key);
        }
      });
    }
  });

  it("gives every item at level + 1 a parent that lists it as a child", () => {
    for (const level of levels.slice(1)) {
      const here = byLevel.get(level)!;
      const before = byLevel.get(level - 1)!;
      const beforeIndex = new Map(before.keys.map((k, i) => [k, i]));
      here.keys.forEach((key, i) => {
        const parent = beforeIndex.get(here.parentKeys[i]);
        expect(parent, `parent of ${key} is missing at level ${level - 1}`).toBeDefined();
        expect(childrenOf(before, parent!)).toContain(key);
      });
    }
  });

  it("has children that partition the parent's offices (brute-force leaf comparison)", () => {
    for (const level of levels.slice(0, -1)) {
      const here = byLevel.get(level)!;
      here.keys.forEach((key, i) => {
        const own = leavesOf(key);
        const fromChildren = childrenOf(here, i).flatMap(leavesOf);
        expect(fromChildren).toHaveLength(own.length); // no office twice, none dropped
        expect(new Set(fromChildren)).toEqual(new Set(own));
      });
    }
  });

  it("splits at least one cluster, and keeps a survivor as its own child", () => {
    let splits = 0;
    let survivors = 0;
    for (const level of levels.slice(0, -1)) {
      const r = byLevel.get(level)!;
      r.keys.forEach((key, i) => {
        const kids = childrenOf(r, i);
        if (kids.length > 1) splits++;
        if (kids.length === 1 && kids[0] === key) survivors++;
      });
    }
    expect(splits).toBeGreaterThan(0);
    expect(survivors).toBeGreaterThan(0);
  });

  it("agrees with the whole-city answer for partial viewports (parents outside the viewport are found)", () => {
    for (const bbox of viewports()) {
      for (const level of levels) {
        const partial = engine.getClusters(bbox, level, 1);
        const full = byLevel.get(level)!;
        const fullIndex = new Map(full.keys.map((k, i) => [k, i]));
        expect(partial.keys.length).toBeLessThanOrEqual(full.keys.length);
        partial.keys.forEach((key, i) => {
          const at = fullIndex.get(key)!;
          expect(at, `${key} not in the full response`).toBeDefined();
          expect(partial.parentKeys[i]).toBe(full.parentKeys[at]);
          expect(childrenOf(partial, i)).toEqual(childrenOf(full, at));
        });
      }
    }
  });
});

describe("counts", () => {
  const engine = loadedEngine();

  it("reports unique companies per cluster, not offices (brute force)", () => {
    let multiOfficeCompanyInCluster = 0;
    for (const level of [0, 5, 9, 12, 15, 17]) {
      const r = engine.getClusters(WORLD, level, 1);
      r.keys.forEach((key, i) => {
        const leaves = leavesOf(key);
        const companies = new Set(leaves.map((id) => companyOfOffice.get(id)));
        expect(r.officeCounts[i]).toBe(leaves.length);
        expect(r.companyCounts[i]).toBe(companies.size);
        if (r.kinds[i] === KIND_CLUSTER && companies.size < leaves.length) multiOfficeCompanyInCluster++;
      });
    }
    expect(multiOfficeCompanyInCluster).toBeGreaterThan(0); // the dataset has companies with several offices
  });

  it("counts an office as 1 office and 1 company, and carries its company ID", () => {
    const r = engine.getClusters(WORLD, MAX_LEVEL, 1);
    expect(r.officeCounts.every((c) => c === 1)).toBe(true);
    expect(r.companyCounts.every((c) => c === 1)).toBe(true);
    r.keys.forEach((key, i) => expect(r.companyIds[i]).toBe(companyOfOffice.get(Number(key.slice(2)))));
  });

  it("uses -1 as the company ID of a cluster", () => {
    const r = engine.getClusters(WORLD, 0, 1);
    r.kinds.forEach((kind, i) => {
      if (kind === KIND_CLUSTER) expect(r.companyIds[i]).toBe(-1);
    });
  });
});

describe("keys", () => {
  it("is deterministic for the same input and namespace", () => {
    const a = loadedEngine().getClusters(WORLD, 11, 1);
    const b = loadedEngine().getClusters(WORLD, 11, 1);
    expect(b.keys).toEqual(a.keys);
    expect(b.parentKeys).toEqual(a.parentKeys);
  });

  it("puts cluster keys in the data_version and filter_hash namespace, and leaves office keys alone", () => {
    const a = loadedEngine(offices, { dataVersion: "v1", filterHash: "aaa" }).getClusters(WORLD, 11, 1);
    const b = loadedEngine(offices, { dataVersion: "v1", filterHash: "bbb" }).getClusters(WORLD, 11, 1);
    const clusterKeys = (r: ClusterResponse) => r.keys.filter((k) => k.startsWith("c:"));
    expect(clusterKeys(a).length).toBeGreaterThan(0);
    expect(clusterKeys(a).every((k) => k.startsWith("c:v1:aaa:"))).toBe(true);
    expect(clusterKeys(b).every((k) => k.startsWith("c:v1:bbb:"))).toBe(true);
    expect(a.keys.filter((k) => k.startsWith("o:"))).toEqual(b.keys.filter((k) => k.startsWith("o:")));
  });
});

describe("co-located offices", () => {
  it("keeps every office of an identical-coordinate group as its own item above the clustering zoom", () => {
    const group = dataset.groups.filter((g) => g.kind === "identical").sort((a, b) => b.officeIds.length - a.officeIds.length)[0];
    expect(group.officeIds.length).toBeGreaterThanOrEqual(20);
    const r = loadedEngine().getClusters(WORLD, MAX_LEVEL, 1);
    for (const id of group.officeIds) expect(r.keys).toContain(`o:${id}`);
    // One level out they are one cluster: identical points can only be told apart by the stack/spider logic (§7).
    const clustered = loadedEngine().getClusters(WORLD, CLUSTER_OPTIONS.maxZoom, 1);
    expect(clustered.keys.some((k) => k.startsWith("c:") && leavesOf(k).length >= group.officeIds.length)).toBe(true);
  });
});

describe("edge cases", () => {
  it("returns no items for an empty dataset", () => {
    const engine = createClusterEngine();
    engine.load(packPointSet([], NS), 1);
    const r = engine.getClusters(WORLD, 8, 1);
    expect(r.keys).toEqual([]);
    expect(r.childOffsets).toEqual(new Uint32Array([0]));
  });

  it("returns a lone office with itself as parent and child", () => {
    const engine = createClusterEngine();
    engine.load(packPointSet([{ id: 7, companyId: 3, lng: 77.6, lat: 12.97 }], NS), 1);
    const r = engine.getClusters(WORLD, 8, 1);
    expect(r.keys).toEqual(["o:7"]);
    expect(r.parentKeys).toEqual(["o:7"]);
    expect(childrenOf(r, 0)).toEqual(["o:7"]);
  });

  it("throws before load, and on arrays that disagree", () => {
    expect(() => createClusterEngine().getClusters(WORLD, 5, 1)).toThrow(/before load/);
    const bad = packPointSet(offices.slice(0, 3), NS);
    bad.companyIds = new Uint32Array(2);
    expect(() => createClusterEngine().load(bad, 1)).toThrow(/disagree/);
  });

  it("tags the response with the requested generation", () => {
    expect(loadedEngine().getClusters(WORLD, 6, 42).generation).toBe(42);
  });
});

describe("expansion zoom (tap a cluster)", () => {
  it("is the first level at which the cluster is no longer one item, for every cluster at every level", () => {
    const engine = loadedEngine();
    let checked = 0;
    for (const level of [3, 8, 11, 13, 15, 17]) {
      const r = engine.getClusters(WORLD, level, 1);
      r.keys.forEach((key, i) => {
        if (r.kinds[i] !== KIND_CLUSTER) return;
        const zoom = engine.getExpansionZoom(key)!;
        expect(zoom, key).toBeGreaterThan(level);
        expect(zoom, key).toBeLessThanOrEqual(MAX_LEVEL);
        // At the expansion zoom the cluster's offices are in more than one item; one level before they are still one.
        const itemsOf = (z: number) => {
          const members = new Set(leavesOf(key));
          const out = engine.getClusters(WORLD, z, 1);
          return out.keys.filter((k) => leavesOf(k).some((id) => members.has(id)));
        };
        expect(itemsOf(zoom).length, `${key} at its expansion zoom ${zoom}`).toBeGreaterThan(1);
        expect(itemsOf(zoom - 1).length, `${key} one level before`).toBe(1);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("is null for an office, a stack, a malformed key, a key from an earlier load, and before any load", () => {
    const engine = loadedEngine();
    const cluster = engine.getClusters(WORLD, 8, 1).keys.find((k) => k.startsWith("c:"))!;
    expect(engine.getExpansionZoom("o:1")).toBeNull();
    expect(engine.getExpansionZoom("s:o:1")).toBeNull();
    expect(engine.getExpansionZoom("c:test:f0:not-a-number")).toBeNull();
    expect(engine.getExpansionZoom("c:test:f0:99999999")).toBeNull();
    expect(engine.getExpansionZoom(cluster.replace("test:f0", "test:other"))).toBeNull();
    expect(createClusterEngine().getExpansionZoom(cluster)).toBeNull();
  });
});

/** A fake worker whose responses the test releases by hand, in any order. */
function manualApi() {
  const engine = createClusterEngine();
  const pending: Array<() => void> = [];
  const api: AsyncClusterApi = {
    load: async (points, generation) => engine.load(points, generation),
    getExpansionZoom: async (key) => engine.getExpansionZoom(key),
    getClusters: (bbox, zoom, generation) =>
      new Promise((resolve, reject) => {
        pending.push(() => {
          try {
            resolve(engine.getClusters(bbox, zoom, generation));
          } catch (e) {
            reject(e);
          }
        });
      }),
  };
  return { api, release: (i: number) => pending[i]() };
}

describe("stale responses (client)", () => {
  it("drops a response that arrives after a zoom-level change, whatever order they resolve in", async () => {
    for (const order of [[0, 1], [1, 0]]) {
      const { api, release } = manualApi();
      const client = createClusterClient(api);
      await client.load(packPointSet(offices, NS));
      const first = client.getClusters(WORLD, 10.2);
      const second = client.getClusters(WORLD, 11.4);
      order.forEach(release);
      expect(await first).toBeNull();
      const kept = await second;
      expect(kept?.generation).toBe(client.generation);
      expect(client.staleDropped).toBe(1);
    }
  });

  it("drops a response that was in flight when the data was replaced", async () => {
    const { api, release } = manualApi();
    const client = createClusterClient(api);
    await client.load(packPointSet(offices, NS));
    const inFlight = client.getClusters(WORLD, 9);
    await client.load(packPointSet(offices.slice(0, 100), { dataVersion: "test", filterHash: "f1" }));
    release(0);
    expect(await inFlight).toBeNull();
  });

  it("keeps the generation on a pan inside the same integer zoom, and accepts both responses", async () => {
    const { api, release } = manualApi();
    const client = createClusterClient(api);
    await client.load(packPointSet(offices, NS));
    const a = client.getClusters(WORLD, 10.1);
    const generation = client.generation;
    const b = client.getClusters(WORLD, 10.9);
    expect(client.generation).toBe(generation);
    release(0);
    release(1);
    expect(await a).not.toBeNull();
    expect(await b).not.toBeNull();
    expect(client.staleDropped).toBe(0);
  });

  it("bumps the generation on every load and every integer zoom change", async () => {
    const { api, release } = manualApi();
    const client = createClusterClient(api);
    expect(client.generation).toBe(0);
    await client.load(packPointSet(offices, NS));
    expect(client.generation).toBe(1);
    const p = client.getClusters(WORLD, 5);
    expect(client.generation).toBe(2);
    release(0);
    await p;
    void client.getClusters(WORLD, 6);
    expect(client.generation).toBe(3);
  });

  it("rejects calls after dispose and runs the cleanup once", async () => {
    let disposed = 0;
    const client = createClusterClient(manualApi().api, () => disposed++);
    client.dispose();
    client.dispose();
    expect(disposed).toBe(1);
    await expect(client.getClusters(WORLD, 5)).rejects.toThrow(/disposed/);
    await expect(client.load(packPointSet([], NS))).rejects.toThrow(/disposed/);
  });
});

describe("through Comlink (MessageChannel stands in for the worker boundary)", () => {
  it("round-trips a load and a request, and transfers the typed arrays", async () => {
    const { port1, port2 } = new MessageChannel();
    expose(createClusterWorkerApi(), port1 as unknown as Parameters<typeof expose>[1]);
    const remote = wrap<ClusterWorkerApi>(port2 as unknown as Parameters<typeof wrap>[0]);
    const client = createClusterClient(remote);
    try {
      const points = packPointSet(offices, NS);
      const loaded = await client.load(points);
      expect(loaded).toEqual({ generation: 1, officeCount: offices.length });
      expect(points.lngLat.byteLength).toBe(0); // moved, not copied

      const response = await client.getClusters(WORLD, 12);
      expect(response).not.toBeNull();
      const expected = loadedEngine().getClusters(WORLD, 12, 2);
      expect(response!.generation).toBe(2);
      expect(response!.keys).toEqual(expected.keys);
      expect(response!.lngLat).toEqual(expected.lngLat);
      expect(response!.childKeys).toEqual(expected.childKeys);
      expect(response!.officeCounts.reduce((a, b) => a + b, 0)).toBe(offices.length);
    } finally {
      remote[releaseProxy]();
      port1.close();
      port2.close();
    }
  });
});
