import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkOutput,
  countHeaderRules,
  countRedirects,
} from "@/scripts/check-static-limits.mts";

describe("countRedirects", () => {
  it("separates static from dynamic rules and skips comments", () => {
    const text = [
      "# old slugs",
      "/bengaluru /bangalore 301",
      "/companies/old-name /companies/new-name 301",
      "/blog/* /news/:splat 301",
      "/c/:slug /companies/:slug 301",
      "",
    ].join("\n");
    expect(countRedirects(text)).toEqual({ static: 2, dynamic: 2 });
  });
});

describe("countHeaderRules", () => {
  it("counts URL lines, not indented header lines", () => {
    const text = "/_next/static/*\n  Cache-Control: immutable\n/*\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n";
    expect(countHeaderRules(text)).toBe(2);
  });
});

describe("checkOutput", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function makeOut(files: Record<string, string>) {
    dir = mkdtempSync(path.join(tmpdir(), "out-"));
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), content);
    }
    return dir;
  }

  it("passes a clean export", () => {
    const report = checkOutput(makeOut({ "index.html": "<h1>ok</h1>", "_headers": "/*\n  X: y\n" }));
    expect(report.problems).toEqual([]);
    expect(report.files).toBe(2);
    expect(report.headerRules).toBe(1);
  });

  it("flags secret-looking strings in the output", () => {
    const report = checkOutput(makeOut({ "app.js": 'const k = "service_role";' }));
    expect(report.problems.join()).toMatch(/secret pattern/);
  });

  it("flags too many static redirects", () => {
    const lines = Array.from({ length: 2001 }, (_, i) => `/old-${i} /new-${i} 301`).join("\n");
    const report = checkOutput(makeOut({ "_redirects": lines }));
    expect(report.problems.join()).toMatch(/2001 static redirects/);
  });
});
