import type { Metadata } from "next";
import { MapLayerDemo } from "./map-layer-demo";

export const metadata: Metadata = {
  title: "Marker layer check",
  robots: { index: false },
};

// P2-03: the custom WebGL marker layer on a basemap. With no Geoapify key it draws on a blank Milky
// background, so the layer can be checked (and tested in CI) without one.
export default function MapLayerPage() {
  return <MapLayerDemo apiKey={process.env.NEXT_PUBLIC_GEOAPIFY_KEY ?? ""} />;
}
