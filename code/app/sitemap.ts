import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

// City and company pages join this list in P4-02 and P6-01, with lastModified
// taken from the build snapshot (ADR-0006, "Indexed").
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE_URL}/` }];
}
