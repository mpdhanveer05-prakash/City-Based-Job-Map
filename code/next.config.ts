import path from "node:path";
import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // The app lives in code/; pin the root so a stray lockfile higher up is never used.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;

// Makes Cloudflare bindings available to `next dev` (OpenNext get-started guide).
initOpenNextCloudflareForDev();
