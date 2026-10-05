import { describe, expect, it, vi } from "vitest";
import { handleRebuild, type PublishOutcome, type RebuildDeps } from "../../supabase/functions/_shared/rebuild-handler";

const ORIGIN = "https://company-map.example";
const AUTH = "Bearer user.jwt.token";

function deps(publish: PublishOutcome | Error, dispatch: { ok: boolean; status: number } | Error = { ok: true, status: 204 }) {
  const publishNow = vi.fn(async () => {
    if (publish instanceof Error) throw publish;
    return publish;
  });
  const dispatchRebuild = vi.fn(async () => {
    if (dispatch instanceof Error) throw dispatch;
    return dispatch;
  });
  const d: RebuildDeps = { publishNow, dispatchRebuild, allowedOrigins: [ORIGIN] };
  return { d, publishNow, dispatchRebuild };
}

const ok = (rebuild: boolean, retry = 0): PublishOutcome => ({
  ok: true,
  result: { versions: { bangalore: 4, chennai: 4 }, rebuild, retry_after_seconds: retry },
});

const post = (headers: Record<string, string> = { origin: ORIGIN, authorization: AUTH }) =>
  new Request("https://p.supabase.co/functions/v1/request-rebuild", { method: "POST", headers });

describe("request-rebuild handler", () => {
  it("publishes as the caller, starts the build, and says so", async () => {
    const { d, publishNow, dispatchRebuild } = deps(ok(true));
    const res = await handleRebuild(post(), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, rebuild_requested: true, retry_after_seconds: 0, versions: { bangalore: 4, chennai: 4 } });
    expect(publishNow).toHaveBeenCalledWith(AUTH);
    expect(dispatchRebuild).toHaveBeenCalledTimes(1);
  });

  it("does not start a second build inside the debounce, and says how long to wait", async () => {
    const { d, dispatchRebuild } = deps(ok(false, 420));
    const res = await handleRebuild(post(), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, rebuild_requested: false, retry_after_seconds: 420 });
    expect(dispatchRebuild).not.toHaveBeenCalled();
  });

  it("answers 403 when the database says the caller is below reviewer, and never dispatches", async () => {
    const { d, dispatchRebuild } = deps({ ok: false, reason: "denied", message: "publishing needs a reviewer" });
    const res = await handleRebuild(post(), d);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/reviewer or an admin/);
    expect(dispatchRebuild).not.toHaveBeenCalled();
  });

  it("answers 401 without a bearer token, and does not call the database", async () => {
    const { d, publishNow } = deps(ok(true));
    for (const authorization of [undefined, "", "Basic abc", "Bearer", "Bearer "]) {
      const headers: Record<string, string> = { origin: ORIGIN };
      if (authorization !== undefined) headers.authorization = authorization;
      expect((await handleRebuild(post(headers), d)).status, String(authorization)).toBe(401);
    }
    expect(publishNow).not.toHaveBeenCalled();
  });

  it("refuses another origin and a missing origin, before anything else", async () => {
    const { d, publishNow } = deps(ok(true));
    expect((await handleRebuild(post({ origin: "https://evil.example", authorization: AUTH }), d)).status).toBe(403);
    expect((await handleRebuild(post({ authorization: AUTH }), d)).status).toBe(403);
    expect(publishNow).not.toHaveBeenCalled();
  });

  it("answers the browser's CORS handshake for the site's origin only", async () => {
    const { d } = deps(ok(true));
    const good = await handleRebuild(new Request("https://p.co/x", { method: "OPTIONS", headers: { origin: ORIGIN } }), d);
    expect(good.status).toBe(204);
    expect(good.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(good.headers.get("access-control-allow-headers")).toContain("authorization");
    const bad = await handleRebuild(new Request("https://p.co/x", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), d);
    expect(bad.status).toBe(403);
  });

  it("refuses other methods", async () => {
    const { d } = deps(ok(true));
    const res = await handleRebuild(new Request("https://p.co/x", { method: "GET", headers: { origin: ORIGIN } }), d);
    expect(res.status).toBe(405);
  });

  it("says the changes are saved when GitHub refuses or cannot be reached", async () => {
    for (const dispatch of [{ ok: false, status: 401 }, new Error("network")]) {
      const { d } = deps(ok(true), dispatch);
      const res = await handleRebuild(post(), d);
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false, rebuild_requested: false });
      expect(body.error).toMatch(/saved/);
      expect(body.versions).toEqual({ bangalore: 4, chennai: 4 });
    }
  });

  it("answers 502 when the database call fails, and does not throw", async () => {
    expect((await handleRebuild(post(), deps({ ok: false, reason: "error", message: "The database refused the request." }).d)).status).toBe(502);
    expect((await handleRebuild(post(), deps(new Error("down")).d)).status).toBe(502);
  });

  it("never puts a token or the caller's JWT in a response", async () => {
    const { d } = deps(ok(true));
    const text = await (await handleRebuild(post(), d)).text();
    expect(text).not.toContain("user.jwt.token");
    expect(text).not.toMatch(/token/i);
  });
});
