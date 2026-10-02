// Main-thread side of the clustering worker. Owns the generation counter and drops stale responses (map-spec §3).
import { releaseProxy, transfer, wrap } from "comlink";
import {
  pointSetTransferables,
  type AsyncClusterApi,
  type BBox,
  type ClusterResponse,
  type ClusterWorkerApi,
  type LoadResult,
  type PointSet,
} from "./protocol.ts";

export type ClusterClient = {
  /** The latest generation issued. A response older than this is dropped. */
  readonly generation: number;
  /** How many responses were dropped as stale. */
  readonly staleDropped: number;
  /**
   * Replace the dataset. Bumps the generation. The arrays inside `points` are transferred to the worker, so the
   * caller must not use them afterwards.
   */
  load(points: PointSet): Promise<LoadResult>;
  /**
   * Items for a viewport. Bumps the generation when the integer zoom changes. Resolves to `null` when a newer
   * generation was issued while this request was in flight: the caller should use the newer request's result.
   */
  getClusters(bbox: BBox, zoom: number): Promise<ClusterResponse | null>;
  /** The zoom at which a cluster first splits, or `null` if the key is not a cluster of the loaded dataset. */
  getExpansionZoom(key: string): Promise<number | null>;
  /** Terminates the worker and releases the proxy (map-spec §9). Later calls reject. */
  dispose(): void;
};

export function createClusterClient(api: AsyncClusterApi, onDispose: () => void = () => {}): ClusterClient {
  let generation = 0;
  let staleDropped = 0;
  let zoomLevel: number | null = null;
  let disposed = false;

  const assertLive = () => {
    if (disposed) throw new Error("The cluster client was disposed.");
  };

  return {
    get generation() {
      return generation;
    },
    get staleDropped() {
      return staleDropped;
    },
    async load(points) {
      assertLive();
      const issued = ++generation;
      return api.load(transfer(points, pointSetTransferables(points)), issued);
    },
    async getClusters(bbox, zoom) {
      assertLive();
      const level = Math.floor(zoom);
      if (level !== zoomLevel) {
        zoomLevel = level;
        generation++;
      }
      const response = await api.getClusters(bbox, zoom, generation);
      if (response.generation < generation) {
        staleDropped++;
        return null;
      }
      return response;
    },
    async getExpansionZoom(key) {
      assertLive();
      return api.getExpansionZoom(key);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      onDispose();
    },
  };
}

/** Starts the real Web Worker. Call it from the browser only, and `dispose()` on unmount or city change. */
export function createClusterWorkerClient(): ClusterClient {
  const worker = new Worker(new URL("./cluster.worker.ts", import.meta.url), { type: "module" });
  const remote = wrap<ClusterWorkerApi>(worker);
  return createClusterClient(remote, () => {
    remote[releaseProxy]();
    worker.terminate();
  });
}
