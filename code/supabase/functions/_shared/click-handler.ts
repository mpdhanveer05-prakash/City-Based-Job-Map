// The logic of the `click` Edge Function (P6-03), kept free of Deno APIs so Vitest can run it. The Deno entry point
// (../click/index.ts) supplies the database call and the allowed origins.
//
// What it does: counts one Apply or Visit website click for a job or a company. The page sends it with
// navigator.sendBeacon when a visitor follows the link; the link works whether or not this is reached. It reads a
// kind and an id and nothing else: no cookie, no address, no user identifier, and it stores none (docs/security.md).
import { z } from "zod";

export const CLICK_KINDS = ["apply", "website"] as const;
export type ClickKind = (typeof CLICK_KINDS)[number];

/** A beacon body is a few dozen bytes. Anything bigger is not one. */
export const MAX_BODY_BYTES = 512;

export const clickBodySchema = z.strictObject({
  kind: z.enum(CLICK_KINDS),
  id: z.guid(),
});

export type RecordResult = { ok: true } | { ok: false; reason: "rejected" | "error" };

export type ClickDeps = {
  /** Calls `record_click` as the service role. "rejected" means the database refused the target (it is not a listed job or a published company). */
  recordClick(kind: ClickKind, id: string): Promise<RecordResult>;
  /** The origins the site is served from (https://example.com). A beacon from any other origin is refused. */
  allowedOrigins: readonly string[];
};

const baseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function corsHeaders(origin: string | null, deps: ClickDeps): Record<string, string> {
  return origin && deps.allowedOrigins.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", Vary: "Origin" }
    : {};
}

const respond = (status: number, headers: Record<string, string>, body?: string): Response =>
  new Response(body ?? null, { status, headers: { ...baseHeaders, ...headers } });

export async function handleClick(request: Request, deps: ClickDeps): Promise<Response> {
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin, deps);

  if (request.method === "OPTIONS") return respond(origin && cors["Access-Control-Allow-Origin"] ? 204 : 403, cors);
  if (request.method !== "POST") return respond(405, { ...cors, Allow: "POST, OPTIONS" });
  // A missing Origin is refused too: a browser always sends one with a cross-origin beacon.
  if (!origin || !deps.allowedOrigins.includes(origin)) return respond(403, {});

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return respond(413, cors);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return respond(413, cors);

  // sendBeacon sends text/plain (a "simple" content type: no preflight), so the JSON is parsed from the text.
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return respond(400, cors);
  }
  const body = clickBodySchema.safeParse(json);
  if (!body.success) return respond(400, cors);

  const result = await deps.recordClick(body.data.kind, body.data.id).catch((): RecordResult => ({ ok: false, reason: "error" }));
  // A refused target answers the same as an accepted one, so the endpoint cannot be used to probe which ids exist.
  if (result.ok || result.reason === "rejected") return respond(204, cors);
  return respond(503, cors);
}
