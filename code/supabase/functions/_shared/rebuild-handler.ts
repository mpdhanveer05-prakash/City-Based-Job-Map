// The logic of the `request-rebuild` Edge Function (P7-02), kept free of Deno APIs so Vitest can run it. The Deno entry
// point (../request-rebuild/index.ts) supplies the database call, the GitHub call, and the allowed origins.
//
// What it does: a reviewer or admin presses "Publish now". The function calls `publish_now` AS THAT USER (their JWT), so
// the role check is the database's (docs/security.md: the admin JavaScript is public; RLS and RPC checks are the only
// enforcement). `publish_now` bumps the data versions and says whether a build should start now or was already
// requested in the last ten minutes (the debounce of ADR-0006). Only then does this function ask GitHub to run the
// deploy workflow, with a token that only this function holds.

export type PublishResult = { versions: Record<string, number>; rebuild: boolean; retry_after_seconds: number };

export type PublishOutcome =
  | { ok: true; result: PublishResult }
  | { ok: false; reason: "denied" | "error"; message: string };

export type RebuildDeps = {
  /** Calls `publish_now` with the caller's own Authorization header. */
  publishNow(authorization: string): Promise<PublishOutcome>;
  /** Asks GitHub to run the deploy workflow (`repository_dispatch`, type "rebuild"). */
  dispatchRebuild(): Promise<{ ok: boolean; status: number }>;
  allowedOrigins: readonly string[];
};

const baseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Type": "application/json" };

function corsHeaders(origin: string | null, deps: RebuildDeps): Record<string, string> {
  return origin && deps.allowedOrigins.includes(origin)
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

export async function handleRebuild(request: Request, deps: RebuildDeps): Promise<Response> {
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin, deps);

  if (request.method === "OPTIONS") return json(origin && cors["Access-Control-Allow-Origin"] ? 204 : 403, cors);
  if (request.method !== "POST") return json(405, { ...cors, Allow: "POST, OPTIONS" }, { error: "Use POST." });
  if (!origin || !deps.allowedOrigins.includes(origin)) return json(403, {}, { error: "This origin is not allowed." });

  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+/.test(authorization)) return json(401, cors, { error: "Sign in first." });

  const published = await deps.publishNow(authorization).catch((): PublishOutcome => ({ ok: false, reason: "error", message: "The database could not be reached." }));
  if (!published.ok) {
    return published.reason === "denied"
      ? json(403, cors, { error: "Publishing needs a reviewer or an admin." })
      : json(502, cors, { error: published.message });
  }
  const { result } = published;

  if (!result.rebuild) {
    // A build was requested in the last ten minutes: it has not read these changes, but the next one will.
    return json(200, cors, { ok: true, rebuild_requested: false, retry_after_seconds: result.retry_after_seconds, versions: result.versions });
  }
  const dispatched = await deps.dispatchRebuild().catch(() => ({ ok: false, status: 0 }));
  if (!dispatched.ok) {
    // The changes are saved and the versions moved on, but the build did not start. Say so; the nightly build still publishes them.
    return json(502, cors, {
      ok: false,
      rebuild_requested: false,
      error: "The changes are saved, but the build could not be started. The nightly build will publish them, or press Publish now again in ten minutes.",
      versions: result.versions,
    });
  }
  return json(200, cors, { ok: true, rebuild_requested: true, retry_after_seconds: 0, versions: result.versions });
}
