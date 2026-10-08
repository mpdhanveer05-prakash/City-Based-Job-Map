// Edge Function `activate-logo` (migration 20261007160000): makes an approved, copied logo the company's logo after
// checking the SHA-256 of the actual bytes on the server. Deployed WITH JWT verification; request_logo_activation checks
// the caller is a reviewer. All the logic is in ../_shared/logo-activation-handler.ts.
//
// Secrets: ALLOWED_ORIGINS (the site's origins, comma separated). SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY are provided to every function by Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleActivation, type ActivationDeps } from "../_shared/logo-activation-handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean);
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

const deps: ActivationDeps = {
  async requestActivation(authorization, id) {
    const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await asCaller.rpc("request_logo_activation", { p_id: id });
    if (error) {
      if (error.code === "42501") return { ok: false, reason: "denied", message: error.message };
      if (error.code === "23514" || error.code === "P0002") return { ok: false, reason: "refused", message: error.message };
      return { ok: false, reason: "error", message: "The database refused the request." };
    }
    return { ok: true, key: data as string };
  },
  async download(bucket, key) {
    const { data, error } = await service.storage.from(bucket).download(key);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  },
  async complete(id, pendingSha256, publicSha256) {
    const { error } = await service.rpc("complete_logo_activation", { p_id: id, p_pending_sha256: pendingSha256, p_public_sha256: publicSha256 });
    return error ? { ok: false, message: error.message } : { ok: true };
  },
  allowedOrigins,
};

Deno.serve((request) => handleActivation(request, deps));
