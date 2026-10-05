import { describe, expect, it } from "vitest";
import { changedKeys } from "@/lib/admin/audit";
import { describePublish, requestRebuild } from "@/lib/admin/publish";
import { pathWith, withParams } from "@/lib/admin/url";

describe("withParams and pathWith", () => {
  it("sets parameters, keeps the others, and drops empty ones and the first page", () => {
    expect(withParams("status=draft&page=3", { page: "0" })).toBe("status=draft");
    expect(withParams("status=draft", { q: "acme" })).toBe("status=draft&q=acme");
    expect(withParams(new URLSearchParams("status=draft&q=x"), { status: "", q: "y" })).toBe("q=y");
    expect(withParams("", { page: "2" })).toBe("page=2");
  });
  it("makes a path with or without a query", () => {
    expect(pathWith("/admin/jobs", "")).toBe("/admin/jobs");
    expect(pathWith("/admin/jobs", "q=a")).toBe("/admin/jobs?q=a");
  });
});

describe("changedKeys", () => {
  it("lists the fields that differ, sorted, ignoring updated_at", () => {
    expect(changedKeys({ name: "A", slug: "a", updated_at: "1" }, { name: "B", slug: "a", updated_at: "2" })).toEqual(["name"]);
    expect(changedKeys({ b: 1, a: [1] }, { b: 2, a: [2] })).toEqual(["a", "b"]);
  });
  it("sees a field that appeared or disappeared, and compares nested values by content", () => {
    expect(changedKeys({ a: 1 }, { a: 1, b: 2 })).toEqual(["b"]);
    expect(changedKeys({ a: { x: 1 } }, { a: { x: 1 } })).toEqual([]);
  });
  it("has no changed fields for an insert or a delete", () => {
    expect(changedKeys(null, { a: 1 })).toEqual([]);
    expect(changedKeys({ a: 1 }, null)).toEqual([]);
  });
});

describe("describePublish", () => {
  it("says the site is rebuilding after a request that started a build", () => {
    expect(describePublish({ ok: true, rebuild_requested: true }, 200)).toMatchObject({ kind: "success", text: expect.stringMatching(/rebuilding/) });
  });
  it("says when a build was already started, and how long to wait", () => {
    const m = describePublish({ ok: true, rebuild_requested: false, retry_after_seconds: 400 }, 200);
    expect(m.kind).toBe("info");
    expect(m.text).toMatch(/already started in the last ten minutes/);
    expect(m.text).toMatch(/7 minutes/);
    expect(describePublish({ ok: true, rebuild_requested: false, retry_after_seconds: 20 }, 200).text).toMatch(/a minute/);
  });
  it("explains a refusal, a failed build, and no answer", () => {
    expect(describePublish({ error: "Publishing needs a reviewer or an admin." }, 403)).toEqual({ kind: "error", text: "Publishing needs a reviewer or an admin." });
    expect(describePublish({ ok: false, error: "The changes are saved, but the build could not be started." }, 502).text).toMatch(/saved/);
    expect(describePublish(null, 401).text).toMatch(/Sign in again/);
    expect(describePublish(null, 500).text).toMatch(/no answer/);
  });
});

describe("requestRebuild", () => {
  const client = (result: unknown) => ({ functions: { invoke: async () => result } }) as never;
  it("reads a good answer", async () => {
    const m = await requestRebuild(client({ data: { ok: true, rebuild_requested: true }, error: null }));
    expect(m.kind).toBe("success");
  });
  it("reads the JSON body of a refused call", async () => {
    const context = new Response(JSON.stringify({ error: "Publishing needs a reviewer or an admin." }), { status: 403 });
    const m = await requestRebuild(client({ data: null, error: { context } }));
    expect(m).toEqual({ kind: "error", text: "Publishing needs a reviewer or an admin." });
  });
  it("says so when the server cannot be reached", async () => {
    const m = await requestRebuild(client({ data: null, error: new Error("Failed to fetch") }));
    expect(m.text).toMatch(/could not be reached/);
  });
});
