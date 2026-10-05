// Edge Function `submit-feedback` (P8-04): public reports and suggestions. Deployed with JWT verification OFF
// (`[functions.submit-feedback] verify_jwt = false`): a visitor has no account. What stands in for it is the Cloudflare
// Turnstile check, which this function does before it stores anything. All the logic is in ../_shared/feedback-handler.ts.
//
// Secrets (supabase secrets set): ALLOWED_ORIGINS (the site's origins), TURNSTILE_SECRET_KEY, FEEDBACK_SALT (a long random
// string: with the date it makes the daily rate-limit key). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided.
// TURNSTILE_VERIFY_URL exists so the end-to-end test can use a local stand-in; production leaves it unset.
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleFeedback, type SubmitResult, type TurnstileResult } from "../_shared/feedback-handler.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

async function verifyTurnstile(token: string, ip: string | null): Promise<TurnstileResult> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) return { success: false };
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  const response = await fetch(Deno.env.get("TURNSTILE_VERIFY_URL") ?? "https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  if (!response.ok) return { success: false };
  const data = (await response.json()) as { success?: boolean; hostname?: string; action?: string };
  return { success: data.success === true, hostname: data.hostname, action: data.action };
}

async function submit(row: Parameters<Parameters<typeof handleFeedback>[1]["submit"]>[0], clientHash: string): Promise<SubmitResult> {
  const { data, error } = await supabase.rpc("submit_feedback", {
    p_kind: row.kind,
    p_target_type: row.target_type,
    p_target_id: row.target_id ?? null,
    p_message: row.message,
    p_source_url: row.source_url ?? null,
    p_company_name: row.company_name ?? null,
    p_client_hash: `\\x${clientHash}`,
  });
  if (!error) return { ok: true, id: data as string };
  if (error.message === "rate_limited") return { ok: false, reason: "rate_limited" };
  // 22023: the target is not listed. 23514 / 23502: a constraint on the content.
  return { ok: false, reason: ["22023", "23514", "23502"].includes(error.code ?? "") ? "rejected" : "error" };
}

Deno.serve((request) => handleFeedback(request, { verifyTurnstile, submit, salt: Deno.env.get("FEEDBACK_SALT") ?? "", allowedOrigins }));
