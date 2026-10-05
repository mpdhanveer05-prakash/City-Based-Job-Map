import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCsp, inlineScriptHashes, injectCsp } from "@/lib/csp";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("base64");

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title>
<script src="/_next/static/a.js" async></script>
<script>self.__next_f.push([1,"hello"])</script>
<script>self.__next_f.push([1,"hello"])</script>
<script type="module">import("/x.js")</script>
<script type="application/ld+json">{"@type":"Organization","name":"</scr"}</script>
<script>   </script>
</head><body><script>window.x=1</script></body></html>`;

describe("inlineScriptHashes", () => {
  it("hashes each executable inline script once, in order", () => {
    expect(inlineScriptHashes(PAGE)).toEqual([sha('self.__next_f.push([1,"hello"])'), sha('import("/x.js")'), sha("window.x=1")]);
  });
  it("ignores scripts with a src, JSON data blocks, and empty scripts", () => {
    expect(inlineScriptHashes('<script src="/a.js"></script><script type="application/ld+json">{}</script><script> </script>')).toEqual([]);
  });
  it("hashes the exact text, white space included", () => {
    expect(inlineScriptHashes("<script> a </script>")).toEqual([sha(" a ")]);
  });
});

describe("buildCsp", () => {
  const policy = buildCsp(["abc="], { supabaseOrigin: "https://p.supabase.co" });
  const directive = (name: string) => policy.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

  it("allows scripts only from this site, the page's own hashes, and Turnstile: never unsafe-inline or unsafe-eval", () => {
    expect(directive("script-src")).toBe("script-src 'self' 'sha256-abc=' https://challenges.cloudflare.com");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(directive("script-src")).not.toContain("unsafe-inline");
    expect(directive("default-src")).toBe("default-src 'none'");
  });
  it("lets the page talk to its own site, the basemap, Turnstile, and the Supabase project, and nowhere else", () => {
    expect(directive("connect-src")).toBe("connect-src 'self' https://maps.geoapify.com https://challenges.cloudflare.com https://p.supabase.co");
    expect(directive("img-src")).toContain("https://p.supabase.co");
    expect(directive("frame-src")).toBe("frame-src https://challenges.cloudflare.com");
  });
  it("has no Supabase origin in a build without a project", () => {
    expect(buildCsp([], { supabaseOrigin: null })).not.toContain("supabase");
  });
  it("closes the doors a page does not need", () => {
    for (const d of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "worker-src 'self' blob:"]) expect(policy).toContain(d);
  });
});

describe("injectCsp", () => {
  const opts = { supabaseOrigin: "https://p.supabase.co" };

  it("puts the policy first in <head>, with the page's script hashes", () => {
    const out = injectCsp(PAGE, opts);
    expect(out.indexOf('<meta http-equiv="Content-Security-Policy"')).toBeLessThan(out.indexOf("<meta charset"));
    expect(out).toContain(`'sha256-${sha("window.x=1")}'`);
    expect((out.match(/Content-Security-Policy/g) ?? []).length).toBe(1);
  });
  it("is idempotent, and re-hashes a page whose scripts changed", () => {
    const once = injectCsp(PAGE, opts);
    expect(injectCsp(once, opts)).toBe(once);
    const changed = injectCsp(once.replace("window.x=1", "window.x=2"), opts);
    expect(changed).toContain(sha("window.x=2"));
    expect(changed).not.toContain(sha("window.x=1"));
  });
  it("keeps the whole policy inside the content attribute", () => {
    const tag = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(injectCsp(PAGE, opts));
    expect(tag?.[1]).toContain("default-src 'none'");
    expect(tag?.[1]).toContain("object-src 'none'");
  });
  it("leaves a fragment without a head alone", () => {
    expect(injectCsp("<p>hi</p>", opts)).toBe("<p>hi</p>");
  });
});
