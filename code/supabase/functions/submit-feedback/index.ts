// Edge Function `submit-feedback` (P8-04): public reports and suggestions. Deployed with JWT verification OFF
// (`[functions.submit-feedback] verify_jwt = false`): a visitor has no account. What stands in for it is the Cloudflare
// Turnstile check, which this function does before it stores anything. All the logic is in ../_shared/feedback-handler.ts.
//
// Secrets (supabase secrets set): ALLOWED_ORIGINS (the site's origins), TURNSTILE_SECRET_KEY, FEEDBACK_SALT (a long random
// string of at least 32 characters: with the date it makes the daily rate-limit key; without it the form refuses every
// submission), and CLIENT_IP_HEADER with TRUSTED_PROXY_HOPS (where the platform records the visitor's address: set only
// after the hosted check with spoofed headers, docs/security.md; until then the form refuses every submission).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided.
// TURNSTILE_VERIFY_URL exists so the end-to-end test can use a local stand-in; production leaves it unset.
import { createClient } from "npm:@supabase/supabase-js@2";
import { clientIpConfig, handleFeedback, MIN_SALT_LENGTH, type SubmitResult, type TurnstileResult } from "../_shared/feedback-handler.ts";

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

const salt = Deno.env.get("FEEDBACK_SALT") ?? "";
if (salt.length < MIN_SALT_LENGTH) console.error(`submit-feedback: FEEDBACK_SALT is missing or shorter than ${MIN_SALT_LENGTH} characters; every submission is refused`);
// A bad value stops the function at start-up, so the mistake is seen at once; no value at all means the form stays off.
const clientIp = clientIpConfig((name) => Deno.env.get(name));
if (!clientIp) console.error("submit-feedback: CLIENT_IP_HEADER and TRUSTED_PROXY_HOPS are not set (hosted check pending); every submission is refused");

Deno.serve((request) => handleFeedback(request, { verifyTurnstile, submit, salt, allowedOrigins, clientIp }));
