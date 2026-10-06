import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixSegmentFiles, flatSegmentName } from "@/lib/segment-files";

describe("flatSegmentName (P9-17)", () => {
  it("joins a nested Windows export path into the name the client requests", () => {
    expect(flatSegmentName(["__next.admin", "companies", "__PAGE__.txt"])).toBe("__next.admin.companies.__PAGE__.txt");
    expect(flatSegmentName(["__next.!KHB1YmxpYyk", "companies", "$d$slug", "__PAGE__.txt"])).toBe("__next.!KHB1YmxpYyk.companies.$d$slug.__PAGE__.txt");
  });
  it("refuses anything that is not a nested segment file", () => {
    expect(() => flatSegmentName(["__next._tree.txt"])).toThrow();
    expect(() => flatSegmentName(["other", "x.txt"])).toThrow();
  });
});

/** Every file under `root`, with its bytes and modification time. */
function snapshot(root: string): Record<string, { body: string; mtime: number }> {
  const out: Record<string, { body: string; mtime: number }> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out[path.relative(root, full).split(path.sep).join("/")] = { body: readFileSync(full, "utf8"), mtime: statSync(full).mtimeMs };
    }
  };
  walk(root);
  return out;
}

function write(root: string, rel: string, body: string) {
  const full = path.join(root, ...rel.split("/"));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
}

describe("fixSegmentFiles on real folders (P9-17)", () => {
  const roots: string[] = [];
  const temp = () => {
    const r = mkdtempSync(path.join(tmpdir(), "segments-"));
    roots.push(r);
    return r;
  };
  afterEach(() => {
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  });

  // What the same page looks like from each operating system's export.
  const common = {
    "companies/acme.html": "<html>page</html>",
    "companies/acme.txt": "page payload",
    "companies/acme/__next._tree.txt": "tree",
    "companies/acme/__next._full.txt": "full",
    "index.html": "<html>home</html>",
  };
  const linux = { ...common, "companies/acme/__next.!KHB1YmxpYyk.companies.$d$slug.__PAGE__.txt": "segment" };
  const windows = { ...common, "companies/acme/__next.!KHB1YmxpYyk/companies/$d$slug/__PAGE__.txt": "segment" };

  it("leaves a correct (Linux) export untouched: same files, same bytes, same times", () => {
    const root = temp();
    for (const [rel, body] of Object.entries(linux)) write(root, rel, body);
    const before = snapshot(root);
    expect(fixSegmentFiles(root)).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  });

  it("repairs a Windows export into exactly the Linux layout, moving only the nested files", () => {
    const root = temp();
    for (const [rel, body] of Object.entries(windows)) write(root, rel, body);
    const before = snapshot(root);
    const moves = fixSegmentFiles(root).map(([a, b]) => [a.split(path.sep).join("/"), b.split(path.sep).join("/")]);
    expect(moves).toEqual([["companies/acme/__next.!KHB1YmxpYyk/companies/$d$slug/__PAGE__.txt", "companies/acme/__next.!KHB1YmxpYyk.companies.$d$slug.__PAGE__.txt"]]);
    const after = snapshot(root);
    expect(Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v.body]))).toEqual(linux);
    // Every file that was not nested keeps its bytes and its modification time.
    for (const rel of Object.keys(common)) expect(after[rel]).toEqual(before[rel]);
    // The emptied folders are gone.
    expect(readdirSync(path.join(root, "companies/acme")).some((n) => n === "__next.!KHB1YmxpYyk")).toBe(false);
  });

  it("is safe to run twice: the second run changes nothing", () => {
    const root = temp();
    for (const [rel, body] of Object.entries(windows)) write(root, rel, body);
    fixSegmentFiles(root);
    const once = snapshot(root);
    expect(fixSegmentFiles(root)).toEqual([]);
    expect(snapshot(root)).toEqual(once);
  });

  it("never overwrites a flat file that already exists", () => {
    const root = temp();
    for (const [rel, body] of Object.entries({ ...windows, "companies/acme/__next.!KHB1YmxpYyk.companies.$d$slug.__PAGE__.txt": "other" })) write(root, rel, body);
    expect(() => fixSegmentFiles(root)).toThrow(/refusing to overwrite/);
    expect(readFileSync(path.join(root, "companies/acme/__next.!KHB1YmxpYyk.companies.$d$slug.__PAGE__.txt"), "utf8")).toBe("other");
  });
});
