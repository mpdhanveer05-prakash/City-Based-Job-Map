import type { MetadataRoute } from "next";
import { loadAllCities } from "@/lib/data/city-data";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

// The home page and each city's explorer. Company pages join this list in P6-01. The datasets carry
// no timestamps (so a rebuild with unchanged data is byte-identical), hence no lastModified.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE_URL}/` }, ...loadAllCities().map((city) => ({ url: `${SITE_URL}/${city.slug}` }))];
}
