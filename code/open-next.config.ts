import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// Prerendered pages are served read-only from Workers Static Assets.
// No R2 or KV: nothing revalidates yet. If ISR is adopted, switch to the R2 cache
// and record it in ADR-0003.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
