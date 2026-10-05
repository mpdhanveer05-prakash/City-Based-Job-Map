// The Content-Security-Policy of the static site (P9-02, docs/security.md). A static export has inline scripts (Next's
// hydration data differs on every page), and a `_headers` rule per page would exceed Cloudflare's 100-rule limit, so the policy
// is written into each page as a <meta http-equiv="Content-Security-Policy"> after the build, with the SHA-256 of every inline
// script that page contains. `script-src` therefore has no 'unsafe-inline'. The two things a meta policy cannot do, framing
// and reporting, are in public/_headers (X-Frame-Options).
import { createHash } from "node:crypto";

export type CspOptions = {
  /** The Supabase project's origin (REST, Auth, Functions, Storage). Null in a build without one. */
  supabaseOrigin: string | null;
  /** Extra origins to allow for connections, for a local stack (http://127.0.0.1:54321). */
  extraConnect?: readonly string[];
};

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
const TYPE_ATTR = /\btype\s*=\s*["']?([^"'\s>]+)/i;

/** The base64 SHA-256 of each executable inline script in the page, in order, without repeats. JSON data blocks are not scripts. */
export function inlineScriptHashes(html: string): string[] {
  const seen = new Set<string>();
  for (const match of html.matchAll(INLINE_SCRIPT)) {
    const type = TYPE_ATTR.exec(match[1])?.[1]?.toLowerCase();
    if (type && type !== "module" && type !== "text/javascript" && type !== "application/javascript") continue; // ld+json, importmap, speculationrules
    if (match[2].trim() === "") continue;
    seen.add(createHash("sha256").update(match[2], "utf8").digest("base64"));
  }
  return [...seen];
}

export function buildCsp(hashes: readonly string[], options: CspOptions): string {
  const connect = ["'self'", "https://maps.geoapify.com", "https://challenges.cloudflare.com", ...(options.supabaseOrigin ? [options.supabaseOrigin] : []), ...(options.extraConnect ?? [])];
  const images = ["'self'", "data:", "blob:", ...(options.supabaseOrigin ? [options.supabaseOrigin] : [])];
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'none'"]],
    ["script-src", ["'self'", ...hashes.map((h) => `'sha256-${h}'`), "https://challenges.cloudflare.com"]],
    // Inline style attributes (positions that are computed) need 'unsafe-inline' for styles; a style cannot run code.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", images],
    ["font-src", ["'self'"]],
    ["connect-src", connect],
    ["frame-src", ["https://challenges.cloudflare.com"]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["object-src", ["'none'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

const META = /<meta http-equiv="Content-Security-Policy"[^>]*>/i;

/** Puts the policy first in <head> (replacing one that is already there, so running twice changes nothing). */
export function injectCsp(html: string, options: CspOptions): string {
  const policy = buildCsp(inlineScriptHashes(html.replace(META, "")), options);
  const tag = `<meta http-equiv="Content-Security-Policy" content="${policy.replace(/"/g, "&quot;")}">`;
  const cleaned = html.replace(META, "");
  const head = /<head[^>]*>/i.exec(cleaned);
  if (!head) return cleaned; // a fragment, not a page
  const at = head.index + head[0].length;
  return cleaned.slice(0, at) + tag + cleaned.slice(at);
}
