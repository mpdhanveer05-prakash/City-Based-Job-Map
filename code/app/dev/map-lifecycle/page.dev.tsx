import type { Metadata } from "next";
import { LifecycleDemo } from "./lifecycle-demo";

export const metadata: Metadata = {
  title: "Map lifecycle check",
  robots: { index: false },
};

// P2-08: mounts and unmounts the marker layer page on demand, so a test can mount it 20 times and measure what is
// left behind (heap, event listeners, workers, WebGL contexts). It draws on the blank background unless the query
// string says `?basemap=on`, so a 20-cycle run does not spend Geoapify credits.
export default function MapLifecyclePage() {
  return <LifecycleDemo apiKey={process.env.NEXT_PUBLIC_GEOAPIFY_KEY ?? ""} />;
}
