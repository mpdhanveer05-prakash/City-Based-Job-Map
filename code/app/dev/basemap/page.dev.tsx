import type { Metadata } from "next";
import { BasemapDemo } from "./basemap-demo";

export const metadata: Metadata = {
  title: "Basemap check",
  robots: { index: false },
};

// P1-05: the Geoapify style, re-coloured to the design-system palette, with attribution.
// Company markers arrive with the custom layer in P2-03.
export default function BasemapPage() {
  return <BasemapDemo apiKey={process.env.NEXT_PUBLIC_GEOAPIFY_KEY ?? ""} />;
}
