import { describe, expect, it, vi } from "vitest";
import { handleClick, MAX_BODY_BYTES, type ClickDeps, type RecordResult } from "../../supabase/functions/_shared/click-handler";

const ORIGIN = "https://company-map.example";
const ID = "00000000-0000-4000-8000-0000000000d1";

function deps(result: RecordResult | Error = { ok: true }) {
  const recordClick = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const d: ClickDeps = { recordClick, allowedOrigins: [ORIGIN, "https://staging.example"] };
  return { d, recordClick };
}

const post = (body: unknown, headers: Record<string, string> = { origin: ORIGIN }, raw = false) =>
  new Request("https://project.supabase.co/functions/v1/click", {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8", ...headers },
    body: raw ? (body as string) : JSON.stringify(body),
  });

describe("click handler", () => {
  it("counts a valid beacon and answers 204 with nothing in the body", async () => {
    const { d, recordClick } = deps();
    const res = await handleClick(post({ kind: "apply", id: ID }), d);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(recordClick).toHaveBeenCalledWith("apply", ID);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts both kinds", async () => {
    const { d, recordClick } = deps();
    await handleClick(post({ kind: "website", id: ID }), d);
    expect(recordClick).toHaveBeenCalledWith("website", ID);
  });

  it("allows the browser's CORS handshake only for the site's own origins", async () => {
    const { d } = deps();
    const ok = await handleClick(new Request("https://p.co/click", { method: "OPTIONS", headers: { origin: ORIGIN } }), d);
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const bad = await handleClick(new Request("https://p.co/click", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), d);
    expect(bad.status).toBe(403);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses another origin, and a request with no origin, without counting", async () => {
    const { d, recordClick } = deps();
    expect((await handleClick(post({ kind: "apply", id: ID }, { origin: "https://evil.example" }), d)).status).toBe(403);
    expect((await handleClick(post({ kind: "apply", id: ID }, {}), d)).status).toBe(403);
    expect(recordClick).not.toHaveBeenCalled();
  });

  it("refuses other methods", async () => {
    const { d } = deps();
    for (const method of ["GET", "PUT", "DELETE"]) {
      const res = await handleClick(new Request("https://p.co/click", { method, headers: { origin: ORIGIN } }), d);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toContain("POST");
    }
  });

  it("rejects a body that is not exactly a kind and a guid", async () => {
    const { d, recordClick } = deps();
    const bad: unknown[] = [
      {},
      { kind: "apply" },
      { id: ID },
      { kind: "share", id: ID },
      { kind: "apply", id: "not-a-guid" },
      { kind: "apply", id: ID, extra: "field" },
      { kind: "apply", id: ID, ip: "203.0.113.9" },
      { kind: ["apply"], id: ID },
      [],
      null,
      "text",
      42,
    ];
    for (const body of bad) expect((await handleClick(post(body), d)).status, JSON.stringify(body)).toBe(400);
    expect((await handleClick(post("{not json", { origin: ORIGIN }, true), d)).status).toBe(400);
    expect((await handleClick(post("", { origin: ORIGIN }, true), d)).status).toBe(400);
    expect(recordClick).not.toHaveBeenCalled();
  });

  it("refuses an oversized body, by its declared length and by its real length", async () => {
    const { d, recordClick } = deps();
    const big = JSON.stringify({ kind: "apply", id: ID, pad: "x".repeat(MAX_BODY_BYTES) });
    expect((await handleClick(post(big, { origin: ORIGIN }, true), d)).status).toBe(413);
    const lying = post({ kind: "apply", id: ID }, { origin: ORIGIN, "content-length": String(MAX_BODY_BYTES + 1) });
    expect((await handleClick(lying, d)).status).toBe(413);
    expect(recordClick).not.toHaveBeenCalled();
  });

  it("answers 204 for a target the database refuses, so ids cannot be probed", async () => {
    const { d } = deps({ ok: false, reason: "rejected" });
    const res = await handleClick(post({ kind: "apply", id: ID }), d);
    expect(res.status).toBe(204);
  });

  it("answers 503 when counting failed, and does not throw when the database call does", async () => {
    expect((await handleClick(post({ kind: "apply", id: ID }), deps({ ok: false, reason: "error" }).d)).status).toBe(503);
    expect((await handleClick(post({ kind: "apply", id: ID }), deps(new Error("connection reset")).d)).status).toBe(503);
  });

  it("never echoes the request back, and sets no cookie", async () => {
    const { d } = deps();
    const res = await handleClick(post({ kind: "apply", id: ID }), d);
    expect(res.headers.get("set-cookie")).toBeNull();
    const refused = await handleClick(post({ kind: "apply", id: "<script>" }), d);
    expect(await refused.text()).toBe("");
  });
});
