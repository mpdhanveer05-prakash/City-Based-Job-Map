import { describe, expect, it, vi } from "vitest";
import { callerIp, clientKey, handleFeedback, MAX_BODY_BYTES, type FeedbackDeps, type SubmitResult, type TurnstileResult } from "../../supabase/functions/_shared/feedback-handler";

const ORIGIN = "https://company-map.example";
const JOB = "00000000-0000-4000-8000-0000000000d1";
const GOOD_TURNSTILE: TurnstileResult = { success: true, hostname: "company-map.example", action: "feedback" };

function deps(over: { turnstile?: TurnstileResult | Error; submit?: SubmitResult | Error } = {}) {
  const verifyTurnstile = vi.fn(async () => {
    if (over.turnstile instanceof Error) throw over.turnstile;
    return over.turnstile ?? GOOD_TURNSTILE;
  });
  const submit = vi.fn(async () => {
    if (over.submit instanceof Error) throw over.submit;
    return over.submit ?? { ok: true as const, id: "11111111-1111-4111-8111-111111111111" };
  });
  const d: FeedbackDeps = { verifyTurnstile, submit, salt: "salt-1", allowedOrigins: [ORIGIN], now: () => new Date("2026-10-05T10:00:00Z") };
  return { d, verifyTurnstile, submit };
}

const report = { kind: "report", target_type: "job", target_id: JOB, message: "The link says this job is closed.", turnstile_token: "x".repeat(20) };
const suggestion = { kind: "suggestion", target_type: "other", company_name: "Acme", source_url: "https://acme.example/about", message: "They have an office in Chennai.", turnstile_token: "x".repeat(20) };

const post = (body: unknown, headers: Record<string, string> = { origin: ORIGIN, "x-forwarded-for": "203.0.113.9, 10.0.0.1" }, raw = false) =>
  new Request("https://p.supabase.co/functions/v1/submit-feedback", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw ? (body as string) : JSON.stringify(body) });

describe("submit-feedback handler", () => {
  it("stores a report and returns only its receipt", async () => {
    const { d, submit } = deps();
    const res = await handleFeedback(post(report), d);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "11111111-1111-4111-8111-111111111111" });
    expect(submit).toHaveBeenCalledTimes(1);
    const [row] = submit.mock.calls[0] as unknown as [Record<string, unknown>, string];
    expect(row).toEqual({ kind: "report", target_type: "job", target_id: JOB, message: "The link says this job is closed." });
    expect(row).not.toHaveProperty("turnstile_token");
  });

  it("stores a suggestion that has a name and a link", async () => {
    const { d } = deps();
    expect((await handleFeedback(post(suggestion), d)).status).toBe(201);
  });

  it("verifies Turnstile BEFORE it stores anything, and stores nothing when the check fails", async () => {
    for (const turnstile of [{ success: false }, { ...GOOD_TURNSTILE, action: "login" }, { ...GOOD_TURNSTILE, hostname: "evil.example" }, { success: true }, new Error("down")]) {
      const { d, submit } = deps({ turnstile });
      const res = await handleFeedback(post(report), d);
      expect(res.status, JSON.stringify(turnstile)).toBe(403);
      expect(submit).not.toHaveBeenCalled();
    }
  });

  it("passes the token and the visitor's first address to Turnstile", async () => {
    const { d, verifyTurnstile } = deps();
    await handleFeedback(post(report), d);
    expect(verifyTurnstile).toHaveBeenCalledWith("x".repeat(20), "203.0.113.9");
  });

  it("does not call Turnstile or the database for a body that is not valid", async () => {
    const bad: unknown[] = [
      {},
      { ...report, message: "" },
      { ...report, message: "x".repeat(1001) },
      { ...report, kind: "complaint" },
      { ...report, target_id: null },
      { ...report, target_type: "other", target_id: JOB },
      { ...report, target_id: "not-a-guid" },
      { ...report, extra: "field" },
      { ...report, email: "me@example.test" },
      { ...report, source_url: "http://insecure.example" },
      { ...report, turnstile_token: "short" },
      { ...suggestion, company_name: undefined },
      { ...suggestion, source_url: undefined },
      { ...suggestion, source_url: "javascript:alert(1)" },
      { ...suggestion, target_type: "company", target_id: JOB },
      [],
      null,
      "text",
    ];
    for (const body of bad) {
      const { d, verifyTurnstile, submit } = deps();
      const res = await handleFeedback(post(body), d);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(verifyTurnstile).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
    }
    const { d } = deps();
    expect((await handleFeedback(post("{broken", { origin: ORIGIN }, true), d)).status).toBe(400);
  });

  it("names the field that is wrong, without echoing what was sent", async () => {
    const { d } = deps();
    const res = await handleFeedback(post({ ...suggestion, source_url: "http://<script>alert(1)</script>" }), d);
    const body = await res.json();
    expect(body.field).toBe("source_url");
    expect(JSON.stringify(body)).not.toContain("<script>");
  });

  it("refuses another origin, a missing origin, other methods, and oversized bodies", async () => {
    const { d, verifyTurnstile } = deps();
    expect((await handleFeedback(post(report, { origin: "https://evil.example" }), d)).status).toBe(403);
    expect((await handleFeedback(post(report, {}), d)).status).toBe(403);
    expect((await handleFeedback(new Request("https://p.co/x", { method: "GET", headers: { origin: ORIGIN } }), d)).status).toBe(405);
    expect((await handleFeedback(post({ ...report, message: "x".repeat(MAX_BODY_BYTES) }), d)).status).toBe(413);
    expect((await handleFeedback(post(report, { origin: ORIGIN, "content-length": String(MAX_BODY_BYTES + 1) }), d)).status).toBe(413);
    expect(verifyTurnstile).not.toHaveBeenCalled();
  });

  it("answers the CORS handshake for the site's origin only", async () => {
    const { d } = deps();
    const ok = await handleFeedback(new Request("https://p.co/x", { method: "OPTIONS", headers: { origin: ORIGIN } }), d);
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect((await handleFeedback(new Request("https://p.co/x", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), d)).status).toBe(403);
  });

  it("maps the database's answers: rate limited, content refused, failure", async () => {
    expect((await handleFeedback(post(report), deps({ submit: { ok: false, reason: "rate_limited" } }).d)).status).toBe(429);
    expect((await handleFeedback(post(report), deps({ submit: { ok: false, reason: "rejected" } }).d)).status).toBe(400);
    expect((await handleFeedback(post(report), deps({ submit: { ok: false, reason: "error" } }).d)).status).toBe(503);
    expect((await handleFeedback(post(report), deps({ submit: new Error("down") }).d)).status).toBe(503);
  });

  it("hands the database a daily salted hash, not the address", async () => {
    const { d, submit } = deps();
    await handleFeedback(post(report), d);
    const hash = (submit.mock.calls[0] as unknown as [unknown, string])[1];
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("203");
    expect(hash).toBe(await clientKey("203.0.113.9", "salt-1", "2026-10-05"));
  });

  it("never puts the address, the token, or a secret in a response", async () => {
    for (const over of [{}, { submit: { ok: false as const, reason: "error" as const } }, { turnstile: { success: false } }]) {
      const text = await (await handleFeedback(post(report), deps(over).d)).text();
      expect(text).not.toContain("203.0.113.9");
      expect(text).not.toContain("x".repeat(20));
      expect(text).not.toContain("salt-1");
    }
  });
});

describe("clientKey and callerIp", () => {
  it("is stable for a sender within a day, and changes with the day, the address, and the salt", async () => {
    const a = await clientKey("203.0.113.9", "salt", "2026-10-05");
    expect(await clientKey("203.0.113.9", "salt", "2026-10-05")).toBe(a);
    expect(await clientKey("203.0.113.9", "salt", "2026-10-06")).not.toBe(a);
    expect(await clientKey("203.0.113.10", "salt", "2026-10-05")).not.toBe(a);
    expect(await clientKey("203.0.113.9", "other", "2026-10-05")).not.toBe(a);
  });

  it("takes the first address of X-Forwarded-For", () => {
    expect(callerIp(new Request("https://p.co", { headers: { "x-forwarded-for": " 1.2.3.4 , 5.6.7.8" } }))).toBe("1.2.3.4");
    expect(callerIp(new Request("https://p.co"))).toBeNull();
  });
});
