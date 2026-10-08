import { describe, expect, it } from "vitest";
import { handleActivation, sha256Hex, type ActivationDeps } from "../../supabase/functions/_shared/logo-activation-handler";

const ORIGIN = "https://company-map.example";
const LOGO = new TextEncoder().encode("the reviewed logo bytes");
const TAMPERED = new TextEncoder().encode("different bytes under the same key");

function deps(over: Partial<ActivationDeps> & { files?: Partial<Record<"company-logos-pending" | "company-logos", Uint8Array | null>> } = {}) {
  const calls: { complete: Array<[number, string, string]> } = { complete: [] };
  const files = { "company-logos-pending": LOGO, "company-logos": LOGO, ...over.files };
  const d: ActivationDeps = {
    requestActivation: async () => ({ ok: true, key: "00000000-0000-4000-8000-000000000001/abc.png" }),
    download: async (bucket) => files[bucket] ?? null,
    complete: async (id, p, c) => {
      calls.complete.push([id, p, c]);
      return { ok: true };
    },
    allowedOrigins: [ORIGIN],
    ...over,
  };
  return { d, calls };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://fn.example/activate-logo", {
    method: "POST",
    headers: { origin: ORIGIN, authorization: "Bearer reviewer-token", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("activate-logo", () => {
  it("hashes both files' bytes itself and passes those hashes, never the client's", async () => {
    const { d, calls } = deps();
    const res = await handleActivation(post({ id: 7, sha256: "client-claim" }), d);
    expect(res.status).toBe(400); // extra fields are refused: the client cannot send a hash
    const ok = await handleActivation(post({ id: 7 }), d);
    expect(ok.status).toBe(200);
    const expected = await sha256Hex(LOGO);
    expect(calls.complete).toEqual([[7, expected, expected]]);
  });

  it("passes the tampered copy's real hash, so the database refuses it", async () => {
    const { d, calls } = deps({ files: { "company-logos": TAMPERED } });
    await handleActivation(post({ id: 7 }), d);
    expect(calls.complete[0][1]).toBe(await sha256Hex(LOGO));
    expect(calls.complete[0][2]).toBe(await sha256Hex(TAMPERED));
  });

  it("reports the database's refusal", async () => {
    const { d } = deps({ complete: async () => ({ ok: false, message: "the public copy's bytes do not match the reviewed upload" }) });
    const res = await handleActivation(post({ id: 7 }), d);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "the public copy's bytes do not match the reviewed upload" });
  });

  it("needs the public copy and the pending upload", async () => {
    expect((await handleActivation(post({ id: 7 }), deps({ files: { "company-logos": null } }).d)).status).toBe(409);
    expect((await handleActivation(post({ id: 7 }), deps({ files: { "company-logos-pending": null } }).d)).status).toBe(409);
  });

  it("refuses a non-reviewer, a foreign origin, a missing token, and a bad body before reading any file", async () => {
    let read = 0;
    const counting = (over: Partial<ActivationDeps> = {}) => deps({ download: async () => (read++, LOGO), ...over }).d;
    expect((await handleActivation(post({ id: 7 }), counting({ requestActivation: async () => ({ ok: false, reason: "denied", message: "x" }) }))).status).toBe(403);
    expect((await handleActivation(post({ id: 7 }, { origin: "https://evil.example" }), counting())).status).toBe(403);
    expect((await handleActivation(post({ id: 7 }, { authorization: "" }), counting())).status).toBe(401);
    expect((await handleActivation(post({ id: -1 }), counting())).status).toBe(400);
    expect((await handleActivation(post("x".repeat(300)), counting())).status).toBe(413);
    expect(read).toBe(0);
  });

  it("computes a standard SHA-256", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
