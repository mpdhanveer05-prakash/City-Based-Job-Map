import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function config(phase: string): NextConfig {
  // /dev/* pages (design tokens, later the map prototype) use the .dev.tsx extension.
  // They're part of the app under `next dev`, and in a build only when DEV_ROUTES=on
  // (staging). Otherwise they aren't routes at all, so production never contains them.
  const devRoutes = phase === PHASE_DEVELOPMENT_SERVER || process.env.DEV_ROUTES === "on";

  return {
    // Static export served as Cloudflare Workers static assets (ADR-0006/0007): every page is built ahead of
    // time into out/. No request-time rendering, Route Handlers, redirects, or headers
    // here; use public/_redirects and public/_headers instead.
    output: "export",
    pageExtensions: devRoutes ? ["tsx", "ts", "dev.tsx"] : ["tsx", "ts"],
    // The app lives in code/; pin the root so a stray lockfile higher up is never used.
    turbopack: {
      root: path.join(__dirname),
    },
  };
}
