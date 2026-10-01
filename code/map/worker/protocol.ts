// Shared types for the clustering worker (map-spec §2 and §3). No DOM, no React.
// Points go in as typed arrays plus an ID table, and clusters come back as compact arrays, never GeoJSON.
import type { BBox } from "./lineage.ts";

export type { BBox } from "./lineage.ts";

/** Supercluster settings: radius, maxZoom and minPoints are the architecture plan's proposals. */
export const CLUSTER_OPTIONS = { radius: 60, maxZoom: 17, minPoints: 2, minZoom: 0, extent: 512 } as const;

/** The lowest and highest zoom levels that have their own cluster tree. */
export const MIN_LEVEL = CLUSTER_OPTIONS.minZoom;
export const MAX_LEVEL = CLUSTER_OPTIONS.maxZoom + 1;

export type PointSet = {
  /** Build snapshot ID. Part of every cluster key (`c:<dataVersion>:<filterHash>:<id>`). */
  dataVersion: string;
  /** Hash of the active filter. A filter change is a new key namespace: no old-to-new matching. */
  filterHash: string;
  /** `[lng0, lat0, lng1, lat1, …]` */
  lngLat: Float64Array;
  officeIds: Uint32Array;
  /** Parallel to `officeIds`. A company with several offices has several points. */
  companyIds: Uint32Array;
};

export type OfficePoint = { id: number; companyId: number; lng: number; lat: number };

export const KIND_OFFICE = 0;
export const KIND_CLUSTER = 1;

export type ClusterResponse = {
  /** The generation of the request that produced this response. */
  generation: number;
  /** The integer zoom level whose tree answered (the requested zoom, clamped to MIN_LEVEL…MAX_LEVEL). */
  level: number;
  /** `o:<officeId>` or `c:<dataVersion>:<filterHash>:<clusterId>`. */
  keys: string[];
  kinds: Uint8Array;
  /** `[lng, lat, …]`, parallel to `keys`. */
  lngLat: Float64Array;
  /** Offices in the item: 1 for an office. */
  officeCounts: Uint32Array;
  /** Unique companies in the item: 1 for an office. */
  companyCounts: Uint32Array;
  /** The company of an office; -1 for a cluster. */
  companyIds: Int32Array;
  /**
   * The key of the item that contains this one at level - 1. It equals the item's own key when the item
   * also exists one level out (it was not absorbed into a bigger cluster).
   */
  parentKeys: string[];
  /** Item i's keys at level + 1 are `childKeys[childOffsets[i] … childOffsets[i + 1]]`. A survivor lists itself. */
  childOffsets: Uint32Array;
  childKeys: string[];
};

export type LoadResult = { generation: number; officeCount: number };

/** What the worker exposes through Comlink. */
export type ClusterWorkerApi = {
  load(points: PointSet, generation: number): LoadResult;
  getClusters(bbox: BBox, zoom: number, generation: number): ClusterResponse;
};

/** The same API as the client sees it: every call is asynchronous. */
export type AsyncClusterApi = {
  [K in keyof ClusterWorkerApi]: (...args: Parameters<ClusterWorkerApi[K]>) => Promise<ReturnType<ClusterWorkerApi[K]>>;
};

export function packPointSet(
  offices: readonly OfficePoint[],
  namespace: { dataVersion: string; filterHash: string },
): PointSet {
  const lngLat = new Float64Array(offices.length * 2);
  const officeIds = new Uint32Array(offices.length);
  const companyIds = new Uint32Array(offices.length);
  offices.forEach((o, i) => {
    lngLat[2 * i] = o.lng;
    lngLat[2 * i + 1] = o.lat;
    officeIds[i] = o.id;
    companyIds[i] = o.companyId;
  });
  return { ...namespace, lngLat, officeIds, companyIds };
}

export const pointSetTransferables = (p: PointSet): ArrayBuffer[] =>
  [p.lngLat.buffer, p.officeIds.buffer, p.companyIds.buffer] as ArrayBuffer[];

export const responseTransferables = (r: ClusterResponse): ArrayBuffer[] =>
  [r.kinds.buffer, r.lngLat.buffer, r.officeCounts.buffer, r.companyCounts.buffer, r.companyIds.buffer, r.childOffsets.buffer] as ArrayBuffer[];
