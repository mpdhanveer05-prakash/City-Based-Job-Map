// The logic of the `submit-feedback` Edge Function (P8-04), free of Deno APIs so Vitest can run it. The Deno entry point
// (../submit-feedback/index.ts) supplies Turnstile, the database call, the salt, and the allowed origins.
//
// Order matters, and is the point of this file (docs/security.md, "Public forms"):
//   1. the method, the origin, and the size are checked;
//   2. the body is parsed and validated with Zod: lengths, https, no unknown keys, the rules for each kind;
//   3. the Turnstile token is verified with Cloudflare, and its hostname and action are checked, BEFORE anything is stored;
//   4. only then is the rate-limit key made (a salted hash that changes daily; the address is never kept) and the row inserted.
// Two things are refused outright rather than worked around (8 Oct 2026): a missing or short FEEDBACK_SALT (every key would
// be guessable), and a request with no client address the platform's own proxy recorded (all of them would share one key,
// or a visitor could pick their own by sending X-Forwarded-For).
// Nothing a visitor sends is published: it lands as `new` for a reviewer.
import { z } from "zod";

export const MAX_BODY_BYTES = 8 * 1024;
/** The shortest FEEDBACK_SALT accepted: a long random string (`openssl rand -hex 32` gives 64 characters). */
export const MIN_SALT_LENGTH = 32;
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
  /** Where the platform records the client's address (clientIpConfig). Null until it is configured: then nothing is accepted. */
  clientIp: ClientIpConfig | null;
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

/** Which header holds the client's address, and how many entries from its right end the trusted proxies wrote. */
export type ClientIpConfig = { header: string; trustedHops: number };

/**
 * CLIENT_IP_HEADER and TRUSTED_PROXY_HOPS (function secrets). There is NO default: which header and entry carry the visitor's
 * address on the hosted platform is checked there, with spoofed headers, before the form is enabled (docs/security.md).
 * Until both are set this returns null and the form accepts nothing. A half-set or malformed value is a configuration error.
 */
export function clientIpConfig(get: (name: string) => string | undefined): ClientIpConfig | null {
  const header = (get("CLIENT_IP_HEADER") ?? "").trim().toLowerCase();
  const hops = (get("TRUSTED_PROXY_HOPS") ?? "").trim();
  if (header === "" && hops === "") return null;
  if (header === "" || hops === "") throw new Error("CLIENT_IP_HEADER and TRUSTED_PROXY_HOPS are set together, after the hosted check");
  if (!/^[a-z0-9-]+$/.test(header)) throw new Error("CLIENT_IP_HEADER must be a header name");
  const trustedHops = Number(hops);
  if (!Number.isInteger(trustedHops) || trustedHops < 1 || trustedHops > 5) throw new Error("TRUSTED_PROXY_HOPS must be a whole number from 1 to 5");
  return { header, trustedHops };
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^(?=.*:)[0-9a-f:.]{2,45}$/i;
const isIp = (v: string) => IPV4.test(v) || IPV6.test(v);

/**
 * The client's address as the platform's own proxy recorded it, or null when there is none to trust. Only hashed, never
 * stored or logged.
 *
 * X-Forwarded-For is a list the client can start: a visitor may send "X-Forwarded-For: 1.2.3.4" themselves, and each proxy
 * appends the address it saw. So the address is the `trustedHops`-th entry from the RIGHT (the one a trusted proxy wrote);
 * everything to its left was written by the client and is ignored. A header the edge sets whole (CF-Connecting-IP) is read
 * with trustedHops 1. Which header and hop count are right is never assumed: it is checked on the hosted project.
 */
export function trustedClientIp(request: Request, config: ClientIpConfig): string | null {
  const parts = (request.headers.get(config.header) ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const candidate = parts.length >= config.trustedHops ? parts[parts.length - config.trustedHops] : "";
  return isIp(candidate) ? candidate : null;
}

export async function handleFeedback(request: Request, deps: FeedbackDeps): Promise<Response> {
  const origin = request.headers.get("origin");
  const c = cors(origin, deps);

  if (request.method === "OPTIONS") return reply(origin && c["Access-Control-Allow-Origin"] ? 204 : 403, c);
  if (request.method !== "POST") return reply(405, { ...c, Allow: "POST, OPTIONS" }, { error: "Use POST." });
  if (!origin || !deps.allowedOrigins.includes(origin)) return reply(403, {}, { error: "This origin is not allowed." });
  // A missing or short salt would make every rate-limit key guessable, and without a checked source for the visitor's
  // address no key can be trusted: refuse before anything else runs.
  if (deps.salt.length < MIN_SALT_LENGTH || !deps.clientIp) return reply(503, c, { error: "This form is not available right now." });

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

  // No address the platform recorded: refuse, rather than put every such request in one bucket or trust the client's word.
  const ip = trustedClientIp(request, deps.clientIp);
  if (!ip) return reply(503, c, { error: "This form cannot accept submissions from this connection right now." });
  const verified = await deps.verifyTurnstile(turnstile_token, ip).catch((): TurnstileResult => ({ success: false }));
  const hostnames = deps.allowedOrigins.map((o) => new URL(o).hostname);
  if (!verified.success || verified.action !== TURNSTILE_ACTION || !verified.hostname || !hostnames.includes(verified.hostname)) {
    return reply(403, c, { error: "The check that you are a person did not pass. Reload the page and try again." });
  }

  const day = (deps.now?.() ?? new Date()).toISOString().slice(0, 10);
  const hash = await clientKey(ip, deps.salt, day);
  const result = await deps.submit(row, hash).catch((): SubmitResult => ({ ok: false, reason: "error" }));
  if (result.ok) return reply(201, c, { id: result.id });
  if (result.reason === "rate_limited") return reply(429, c, { error: "Too many submissions from this connection. Try again in an hour." });
  if (result.reason === "rejected") return reply(400, c, { error: "That company or job is not listed any more." });
  return reply(503, c, { error: "It could not be saved. Try again in a moment." });
}
