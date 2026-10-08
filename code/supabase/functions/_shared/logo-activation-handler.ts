// The logic of the `activate-logo` Edge Function (migration 20261007160000), kept free of Deno APIs so Vitest can run it.
//
// A reviewer has approved an upload and the admin page has copied it to the public bucket. This function makes it the
// company's logo only if the bytes are right, computing the SHA-256 itself:
//   1. `request_logo_activation` AS THE CALLER (their JWT): the database checks they are a reviewer at aal2 and that the
//      upload is approved, records the request, and returns the storage key;
//   2. with the service key, it downloads the pending upload and the public copy and hashes each file's bytes;
//   3. `complete_logo_activation` (service role only) compares both hashes with the hash the key names.
// Nothing the browser sends is trusted except the logo's id.
import { z } from "zod";

export type ActivationDeps = {
  /** request_logo_activation(p_id) with the caller's Authorization header: the storage key, or why not. */
  requestActivation(authorization: string, id: number): Promise<{ ok: true; key: string } | { ok: false; reason: "denied" | "refused" | "error"; message: string }>;
  /** The object's bytes, read with the service key, or null when it does not exist. */
  download(bucket: "company-logos-pending" | "company-logos", key: string): Promise<Uint8Array | null>;
  /** complete_logo_activation(p_id, pending, public) with the service key. */
  complete(id: number, pendingSha256: string, publicSha256: string): Promise<{ ok: true } | { ok: false; message: string }>;
  allowedOrigins: readonly string[];
};

const Body = z.strictObject({ id: z.number().int().positive() });

const baseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Type": "application/json" };

function corsHeaders(origin: string | null, allowed: readonly string[]): Record<string, string> {
  return origin && allowed.includes(origin)
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
        Vary: "Origin",
      }
    : {};
}

const json = (status: number, headers: Record<string, string>, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { ...baseHeaders, ...headers } });

/** Lower-case hex SHA-256 of the bytes, computed here (WebCrypto: Deno and Node alike). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleActivation(request: Request, deps: ActivationDeps): Promise<Response> {
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin, deps.allowedOrigins);
  if (request.method === "OPTIONS") return json(cors["Access-Control-Allow-Origin"] ? 204 : 403, cors);
  if (request.method !== "POST") return json(405, { ...cors, Allow: "POST, OPTIONS" }, { error: "Use POST." });
  if (!origin || !deps.allowedOrigins.includes(origin)) return json(403, {}, { error: "This origin is not allowed." });

  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+/.test(authorization)) return json(401, cors, { error: "Sign in first." });

  const text = await request.text();
  if (text.length > 256) return json(413, cors, { error: "The request is too large." });
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(JSON.parse(text));
  } catch {
    return json(400, cors, { error: "Send the logo's id." });
  }

  const requested = await deps.requestActivation(authorization, parsed.id).catch(() => ({ ok: false as const, reason: "error" as const, message: "The database could not be reached." }));
  if (!requested.ok) {
    if (requested.reason === "denied") return json(403, cors, { error: "Only a reviewer or admin can make a logo the company's logo." });
    if (requested.reason === "refused") return json(409, cors, { error: requested.message });
    return json(502, cors, { error: requested.message });
  }

  const [pending, copy] = await Promise.all([deps.download("company-logos-pending", requested.key), deps.download("company-logos", requested.key)]).catch(
    () => [undefined, undefined] as const,
  );
  if (pending === undefined || copy === undefined) return json(502, cors, { error: "The files could not be read." });
  if (pending === null) return json(409, cors, { error: "The reviewed upload is missing." });
  if (copy === null) return json(409, cors, { error: "Copy the approved file to the public bucket first." });

  const [pendingHash, copyHash] = await Promise.all([sha256Hex(pending), sha256Hex(copy)]);
  const done = await deps.complete(parsed.id, pendingHash, copyHash).catch(() => ({ ok: false as const, message: "The database could not be reached." }));
  if (!done.ok) return json(409, cors, { error: done.message });
  return json(200, cors, { ok: true, sha256: copyHash });
}
