// The object the worker exposes through Comlink. It lives apart from cluster.worker.ts so tests can expose it on a
// MessageChannel without starting a real Worker.
import { transfer } from "comlink";
import { createClusterEngine } from "./cluster-engine.ts";
import { responseTransferables, type ClusterWorkerApi } from "./protocol.ts";

export function createClusterWorkerApi(): ClusterWorkerApi {
  const engine = createClusterEngine();
  return {
    load: (points, generation) => engine.load(points, generation),
    // The response's typed arrays move to the main thread instead of being copied.
    getExpansionZoom: (key) => engine.getExpansionZoom(key),
    getClusters: (bbox, zoom, generation) => {
      const response = engine.getClusters(bbox, zoom, generation);
      return transfer(response, responseTransferables(response));
    },
  };
}
