// The clustering engine behind the worker (P2-02). Pure: no Worker, no Comlink, no DOM, so Vitest runs it directly.
// Supercluster is the only clustering engine (map-spec §1).
import Supercluster, { type ClusterFeature, type PointFeature } from "supercluster";
import {
  CLUSTER_OPTIONS,
  KIND_CLUSTER,
  KIND_OFFICE,
  MAX_LEVEL,
  MIN_LEVEL,
  type ClusterResponse,
  type LoadResult,
  type PointSet,
} from "./protocol.ts";
import {
  clusterKey,
  computeLineage,
  formationLevel,
  officeKey,
  type BBox,
  type ClusterNode,
  type LineageSource,
} from "./lineage.ts";

type OfficeProps = { company: number };
type ClusterProps = Record<string, never>;
type Feature = ClusterFeature<ClusterProps> | PointFeature<OfficeProps>;

const isCluster = (f: Feature): f is ClusterFeature<ClusterProps> =>
  (f.properties as { cluster?: boolean }).cluster === true;

/** Supercluster clamps the zoom the same way, so the level we report is the tree that answered. */
export const levelForZoom = (zoom: number): number => Math.max(MIN_LEVEL, Math.min(Math.floor(zoom), MAX_LEVEL));

export type ClusterEngine = {
  load(points: PointSet, generation: number): LoadResult;
  getClusters(bbox: BBox, zoom: number, generation: number): ClusterResponse;
};

export function createClusterEngine(): ClusterEngine {
  let index: Supercluster<OfficeProps, ClusterProps> | null = null;
  let source: LineageSource | null = null;
  let namespace = { dataVersion: "", filterHash: "" };
  // Unique companies per cluster, computed on first use. Cluster IDs are fixed for one load.
  let companyCountCache = new Map<number, number>();

  const toNode = (f: Feature): ClusterNode =>
    isCluster(f)
      ? { key: clusterKey(namespace, f.properties.cluster_id), clusterId: f.properties.cluster_id }
      : { key: officeKey(f.id as number), clusterId: null };

  const uniqueCompanies = (idx: Supercluster<OfficeProps, ClusterProps>, clusterId: number): number => {
    let count = companyCountCache.get(clusterId);
    if (count === undefined) {
      const companies = new Set<number>();
      for (const leaf of idx.getLeaves(clusterId, Infinity)) companies.add(leaf.properties.company);
      count = companies.size;
      companyCountCache.set(clusterId, count);
    }
    return count;
  };

  return {
    load(points, generation) {
      const n = points.officeIds.length;
      if (points.lngLat.length !== 2 * n || points.companyIds.length !== n) {
        throw new Error("PointSet arrays disagree: lngLat needs 2 values per office, companyIds 1.");
      }
      const features: Array<PointFeature<OfficeProps>> = new Array(n);
      for (let i = 0; i < n; i++) {
        features[i] = {
          type: "Feature",
          id: points.officeIds[i],
          properties: { company: points.companyIds[i] },
          geometry: { type: "Point", coordinates: [points.lngLat[2 * i], points.lngLat[2 * i + 1]] },
        };
      }
      const idx = new Supercluster<OfficeProps, ClusterProps>({ ...CLUSTER_OPTIONS }).load(features);
      const { radius, extent } = CLUSTER_OPTIONS;
      index = idx;
      namespace = { dataVersion: points.dataVersion, filterHash: points.filterHash };
      companyCountCache = new Map();
      source = {
        minLevel: MIN_LEVEL,
        // radius / extent / 2^level is the cluster radius in world units; 360 degrees bounds both axes. 10% slack.
        paddingDegrees: (level) => (radius / (extent * 2 ** level)) * 360 * 1.1,
        itemsAt: (bbox, level) => idx.getClusters(bbox, level).map(toNode),
        childrenOf: (clusterId) => idx.getChildren(clusterId).map(toNode),
        formationLevel: (clusterId) => formationLevel(clusterId, n),
      };
      return { generation, officeCount: n };
    },

    getClusters(bbox, zoom, generation) {
      if (!index || !source) throw new Error("getClusters was called before load.");
      const level = levelForZoom(zoom);
      const features = index.getClusters(bbox, level) as Feature[];
      const nodes = features.map(toNode);
      const lineage = computeLineage(source, nodes, level, bbox);

      const count = features.length;
      const kinds = new Uint8Array(count);
      const lngLat = new Float64Array(count * 2);
      const officeCounts = new Uint32Array(count);
      const companyCounts = new Uint32Array(count);
      const companyIds = new Int32Array(count);
      features.forEach((f, i) => {
        lngLat[2 * i] = f.geometry.coordinates[0];
        lngLat[2 * i + 1] = f.geometry.coordinates[1];
        if (isCluster(f)) {
          kinds[i] = KIND_CLUSTER;
          officeCounts[i] = f.properties.point_count;
          companyCounts[i] = uniqueCompanies(index!, f.properties.cluster_id);
          companyIds[i] = -1;
        } else {
          kinds[i] = KIND_OFFICE;
          officeCounts[i] = 1;
          companyCounts[i] = 1;
          companyIds[i] = f.properties.company;
        }
      });
      return {
        generation,
        level,
        keys: nodes.map((node) => node.key),
        kinds,
        lngLat,
        officeCounts,
        companyCounts,
        companyIds,
        ...lineage,
      };
    },
  };
}
