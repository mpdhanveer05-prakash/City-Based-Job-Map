import type { Metadata } from "next";
import { ClusterWorkerDemo } from "./cluster-worker-demo";

export const metadata: Metadata = {
  title: "Cluster worker check",
  robots: { index: false },
};

// P2-02: runs the real clustering Web Worker on the synthetic Bengaluru S dataset, so the build,
// the worker bundle, and Comlink are exercised in a browser. The map layer arrives with P2-03.
export default function ClusterWorkerPage() {
  return <ClusterWorkerDemo />;
}
