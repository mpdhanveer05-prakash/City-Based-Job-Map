// Build-time site settings. The static export bakes these into the output.

/** "production" unless the build sets SITE_ENV=staging (or anything else non-production). */
export const SITE_ENV = process.env.SITE_ENV ?? "production";

/** Only production may be indexed by search engines (ADR-0006). */
export const INDEXABLE = SITE_ENV === "production";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(
  /\/+$/,
  "",
);
