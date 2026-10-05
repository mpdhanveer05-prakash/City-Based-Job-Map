import type { MetadataRoute } from "next";
import { loadAllCities } from "@/lib/data/city-data";
import { loadCompanyPages } from "@/lib/data/company-data";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

// The home page, each city's explorer, and every company page and jobs page (ADR-0006, "Indexed"). The datasets carry
// no timestamps (so a rebuild with unchanged data is byte-identical), hence no lastModified. If the jobs pages move
// onto the company page (P6-04, Option B), the jobs lines come out of this list.
export default function sitemap(): MetadataRoute.Sitemap {
  const companies = [...loadCompanyPages().keys()].sort();
  return [
    { url: `${SITE_URL}/` },
    ...loadAllCities().map((city) => ({ url: `${SITE_URL}/${city.slug}` })),
    ...companies.flatMap((slug) => [{ url: `${SITE_URL}/companies/${slug}` }, { url: `${SITE_URL}/companies/${slug}/jobs` }]),
  ];
}
