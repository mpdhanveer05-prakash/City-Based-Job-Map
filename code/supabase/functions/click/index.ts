// Edge Function `click` (P6-03): counts an outbound Apply or Visit website click. Deployed with JWT verification off
// (`[functions.click] verify_jwt = false` in config.toml), because navigator.sendBeacon cannot set an Authorization
// header. Everything it accepts is validated in ../_shared/click-handler.ts and again by `record_click` in Postgres.
//
// Secrets (supabase secrets set): ALLOWED_ORIGINS, a comma list of the site's origins, for example
// https://company-map.example,https://company-map-staging.company-map.workers.dev. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided to every function by Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleClick, type ClickKind, type RecordResult } from "../_shared/click-handler.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

async function recordClick(kind: ClickKind, id: string): Promise<RecordResult> {
  const { error } = await supabase.rpc("record_click", { p_kind: kind, p_target_id: id });
  if (!error) return { ok: true };
  // 22023 is what record_click raises for a target that is not public.
  return { ok: false, reason: error.code === "22023" ? "rejected" : "error" };
}

Deno.serve((request) => handleClick(request, { recordClick, allowedOrigins }));
