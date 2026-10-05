// The public report and suggestion forms (P8-04): what they send, and the words for what comes back. The page never talks to
// the database. It posts to the `submit-feedback` Edge Function, which checks Cloudflare Turnstile first (docs/security.md).
import { supabaseUrl } from "./supabase/browser";

export type FeedbackPayload =
  | { kind: "report"; target_type: "company" | "job"; target_id: string; message: string }
  | { kind: "suggestion"; target_type: "other"; company_name: string; source_url: string; message: string };

export type FeedbackOutcome = { ok: true; id: string } | { ok: false; message: string; field?: string };

const placeholder = (v: string | undefined) => !v || v.startsWith("replace-");

export const turnstileSiteKey = (): string | null => {
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  return placeholder(key) ? null : key!;
};

export const feedbackEndpoint = (): string | null => {
  const base = supabaseUrl();
  return base ? `${base}/functions/v1/submit-feedback` : null;
};

/** True when this build can take feedback: it has an endpoint and a Turnstile site key. */
export const feedbackAvailable = (): boolean => feedbackEndpoint() !== null && turnstileSiteKey() !== null;

/** The words for the function's answer. A person never sees a status code. */
export function describeFeedbackResponse(status: number, body: { id?: string; error?: string; field?: string } | null): FeedbackOutcome {
  if (status === 201 && body?.id) return { ok: true, id: body.id };
  const message =
    status === 429
      ? "Too many reports from this connection. Try again in an hour."
      : status === 403
        ? (body?.error ?? "The check that you are a person did not pass. Reload the page and try again.")
        : status === 400 || status === 413
          ? (body?.error ?? "Check the form and try again.")
          : "It could not be saved. Try again in a moment.";
  return { ok: false, message, field: body?.field || undefined };
}

export async function submitFeedback(payload: FeedbackPayload, turnstileToken: string, fetchImpl: typeof fetch = fetch, endpoint: string | null = feedbackEndpoint()): Promise<FeedbackOutcome> {
  if (!endpoint) return { ok: false, message: "Reports are not available right now." };
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      // text/plain keeps this a "simple" request (no preflight); the function reads the body as JSON either way.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ ...payload, turnstile_token: turnstileToken }),
    });
    const body = (await response.json().catch(() => null)) as { id?: string; error?: string; field?: string } | null;
    return describeFeedbackResponse(response.status, body);
  } catch {
    return { ok: false, message: "The server could not be reached. Check the connection and try again." };
  }
}
