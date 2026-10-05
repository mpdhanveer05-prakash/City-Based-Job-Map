// The logic of the `submit-feedback` Edge Function (P8-04), free of Deno APIs so Vitest can run it. The Deno entry point
// (../submit-feedback/index.ts) supplies Turnstile, the database call, the salt, and the allowed origins.
//
// Order matters, and is the point of this file (docs/security.md, "Public forms"):
//   1. the method, the origin, and the size are checked;
//   2. the body is parsed and validated with Zod: lengths, https, no unknown keys, the rules for each kind;
//   3. the Turnstile token is verified with Cloudflare, and its hostname and action are checked, BEFORE anything is stored;
//   4. only then is the rate-limit key made (a salted hash that changes daily; the address is never kept) and the row inserted.
// Nothing a visitor sends is published: it lands as `new` for a reviewer.
import { z } from "zod";

export const MAX_BODY_BYTES = 8 * 1024;
export const TURNSTILE_ACTION = "feedback";

const https = (v: string) => /^https:\/\/[^\s]+$/i.test(v);

export const feedbackSchema = z
  .strictObject({
    kind: z.enum(["report", "suggestion"]),
    target_type: z.enum(["company", "job", "other"]),
    target_id: z.guid().nullish(),
    message: z.string().trim().min(1, "Say what is wrong or what you suggest.").max(1000, "The message is longer than 1000 characters."),
    source_url: z.string().trim().max(1000).refine(https, "The link must start with https://").optional(),
    company_name: z.string().trim().min(1).max(200, "The company name is longer than 200 characters.").optional(),
    turnstile_token: z.string().min(10).max(4096),
  })
  .superRefine((f, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (f.kind === "suggestion") {
      if (f.target_type !== "other" || f.target_id) issue("target_type", "A suggestion is not about an existing company or job.");
      if (!f.company_name) issue("company_name", "Give the company's name.");
      if (!f.source_url) issue("source_url", "Give a link to a page that shows the company exists.");
    } else if ((f.target_type === "other") === Boolean(f.target_id)) {
      issue("target_id", "A report is about one company or one job.");
    }
  });

export type Feedback = z.infer<typeof feedbackSchema>;

export type TurnstileResult = { success: boolean; hostname?: string; action?: string };

export type SubmitResult = { ok: true; id: string } | { ok: false; reason: "rate_limited" | "rejected" | "error" };

export type FeedbackDeps = {
  /** Asks Cloudflare whether the token is genuine and unused. The visitor's address is passed on if known. */
  verifyTurnstile(token: string, ip: string | null): Promise<TurnstileResult>;
  /** Calls `submit_feedback` as the service role. `clientHash` is hex. "rejected" means the database refused the content. */
  submit(row: Omit<Feedback, "turnstile_token">, clientHash: string): Promise<SubmitResult>;
  /** The secret that, with the date, makes the daily rate-limit key. */
  salt: string;
  allowedOrigins: readonly string[];
  now?: () => Date;
};

const headersBase = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Type": "application/json" };

function cors(origin: string | null, deps: FeedbackDeps): Record<string, string> {
  return origin && deps.allowedOrigins.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info", Vary: "Origin" }
    : {};
}

const reply = (status: number, extra: Record<string, string>, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { ...headersBase, ...extra } });

/** HMAC-SHA256 of the day and the address, keyed by the salt: the same sender gets the same key all day, a different one tomorrow. Hex. */
export async function clientKey(ip: string, salt: string, day: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${day}|${ip}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The first address in X-Forwarded-For (what the platform's proxy saw), or null. Only hashed, never stored or logged. */
export const callerIp = (request: Request): string | null => (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;

export async function handleFeedback(request: Request, deps: FeedbackDeps): Promise<Response> {
  const origin = request.headers.get("origin");
  const c = cors(origin, deps);

  if (request.method === "OPTIONS") return reply(origin && c["Access-Control-Allow-Origin"] ? 204 : 403, c);
  if (request.method !== "POST") return reply(405, { ...c, Allow: "POST, OPTIONS" }, { error: "Use POST." });
  if (!origin || !deps.allowedOrigins.includes(origin)) return reply(403, {}, { error: "This origin is not allowed." });

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return reply(413, c, { error: "That is too large." });
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return reply(413, c, { error: "That is too large." });

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return reply(400, c, { error: "That is not valid JSON." });
  }
  const parsed = feedbackSchema.safeParse(json);
  if (!parsed.success) return reply(400, c, { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", field: String(parsed.error.issues[0]?.path[0] ?? "") });
  const { turnstile_token, ...row } = parsed.data;

  const ip = callerIp(request);
  const verified = await deps.verifyTurnstile(turnstile_token, ip).catch((): TurnstileResult => ({ success: false }));
  const hostnames = deps.allowedOrigins.map((o) => new URL(o).hostname);
  if (!verified.success || verified.action !== TURNSTILE_ACTION || !verified.hostname || !hostnames.includes(verified.hostname)) {
    return reply(403, c, { error: "The check that you are a person did not pass. Reload the page and try again." });
  }

  const day = (deps.now?.() ?? new Date()).toISOString().slice(0, 10);
  const hash = await clientKey(ip ?? "unknown", deps.salt, day);
  const result = await deps.submit(row, hash).catch((): SubmitResult => ({ ok: false, reason: "error" }));
  if (result.ok) return reply(201, c, { id: result.id });
  if (result.reason === "rate_limited") return reply(429, c, { error: "Too many submissions from this connection. Try again in an hour." });
  if (result.reason === "rejected") return reply(400, c, { error: "That company or job is not listed any more." });
  return reply(503, c, { error: "It could not be saved. Try again in a moment." });
}
