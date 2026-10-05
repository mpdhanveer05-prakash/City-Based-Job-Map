// Edge Function `request-rebuild` (P7-02): "Publish now". Deployed WITH JWT verification (the default), so Supabase
// rejects a call that has no valid session before this code runs; `publish_now` then checks the role. All the logic is in
// ../_shared/rebuild-handler.ts.
//
// Secrets (supabase secrets set): ALLOWED_ORIGINS (the site's origins, comma separated), GITHUB_DISPATCH_TOKEN (a
// fine-grained token with "Contents: read and write" on this repository only), GITHUB_REPOSITORY (owner/name).
// SUPABASE_URL and SUPABASE_ANON_KEY are provided to every function by Supabase. GITHUB_API_URL is for tests only.
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleRebuild, type PublishOutcome, type PublishResult } from "../_shared/rebuild-handler.ts";

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

async function publishNow(authorization: string): Promise<PublishOutcome> {
  // A client that carries the caller's own token, so row-level security and the role check see the real user.
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("publish_now");
  if (error) {
    // 42501 is what publish_now raises for a caller below reviewer, and what Postgres raises for a missing grant.
    return error.code === "42501"
      ? { ok: false, reason: "denied", message: error.message }
      : { ok: false, reason: "error", message: "The database refused the request." };
  }
  return { ok: true, result: data as PublishResult };
}

async function dispatchRebuild(): Promise<{ ok: boolean; status: number }> {
  const token = Deno.env.get("GITHUB_DISPATCH_TOKEN");
  const repository = Deno.env.get("GITHUB_REPOSITORY");
  if (!token || !repository) return { ok: false, status: 0 };
  // GITHUB_API_URL exists so the end-to-end test can point this at a local stand-in; production leaves it unset.
  const api = (Deno.env.get("GITHUB_API_URL") ?? "https://api.github.com").replace(/\/+$/, "");
  const response = await fetch(`${api}/repos/${repository}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "company-map-request-rebuild",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_type: "rebuild" }),
  });
  // GitHub answers 204 No Content when it accepted the event.
  return { ok: response.status === 204, status: response.status };
}

Deno.serve((request) => handleRebuild(request, { publishNow, dispatchRebuild, allowedOrigins }));
