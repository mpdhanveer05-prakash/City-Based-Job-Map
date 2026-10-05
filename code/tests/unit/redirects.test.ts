import { describe, expect, it } from "vitest";
import { collectRedirects, renderRedirects, type CityRedirects } from "@/lib/redirects";
import { countRedirects } from "../../scripts/check-static-limits.mts";

const city = (name: string, redirects: Array<[string, string]>, currentSlugs: string[]): CityRedirects => ({
  city: name,
  redirects: redirects.map(([old_slug, new_slug]) => ({ old_slug, new_slug })),
  currentSlugs,
});

describe("collectRedirects", () => {
  it("returns the redirects sorted by old slug", () => {
    const out = collectRedirects([city("bangalore", [["zeta-old", "zeta"], ["amber-old", "amber"]], ["amber", "zeta"])]);
    expect(out.map((r) => r.old_slug)).toEqual(["amber-old", "zeta-old"]);
  });

  it("counts a company in two cities once", () => {
    const out = collectRedirects([
      city("bangalore", [["amber-old", "amber"]], ["amber"]),
      city("chennai", [["amber-old", "amber"]], ["amber"]),
    ]);
    expect(out).toEqual([{ old_slug: "amber-old", new_slug: "amber" }]);
  });

  it("flattens a chain so every old slug points at the final page", () => {
    const out = collectRedirects([city("bangalore", [["a", "b"], ["b", "c"], ["c", "d"]], ["d"])]);
    expect(out).toEqual([
      { old_slug: "a", new_slug: "d" },
      { old_slug: "b", new_slug: "d" },
      { old_slug: "c", new_slug: "d" },
    ]);
  });

  it("fails the build when an old slug is in use by a company", () => {
    expect(() => collectRedirects([city("bangalore", [["amber", "birch"]], ["amber", "birch"])])).toThrow(/uses it today/);
    // In the other city counts too: the page would be hidden there.
    expect(() => collectRedirects([city("bangalore", [["amber", "birch"]], ["birch"]), city("chennai", [], ["amber"])])).toThrow(/uses it today/);
  });

  it("fails when one old slug points at two pages, at itself, or in a loop", () => {
    expect(() => collectRedirects([city("bangalore", [["old", "a"]], ["a", "b"]), city("chennai", [["old", "b"]], ["a", "b"])])).toThrow(/both a and b/);
    expect(() => collectRedirects([city("bangalore", [["same", "same"]], ["x"])])).toThrow(/to itself/);
    expect(() => collectRedirects([city("bangalore", [["a", "b"], ["b", "a"]], ["z"])])).toThrow(/loop/);
  });

  it("fails when the target is no company at all", () => {
    expect(() => collectRedirects([city("bangalore", [["old", "gone"]], ["amber"])])).toThrow(/no company uses/);
  });
});

describe("renderRedirects", () => {
  const staticRules = "# static\n/bengaluru /bangalore 301\n/bengaluru/* /bangalore/:splat 301\n";

  it("keeps the static rules and adds a company page and a jobs page rule per old slug", () => {
    const text = renderRedirects(staticRules, [{ old_slug: "amber-old", new_slug: "amber" }]);
    expect(text).toContain("/bengaluru /bangalore 301");
    expect(text).toContain("/companies/amber-old /companies/amber 301");
    expect(text).toContain("/companies/amber-old/jobs /companies/amber/jobs 301");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("is only the static rules plus a comment when there are none", () => {
    expect(countRedirects(renderRedirects(staticRules, []))).toEqual({ static: 1, dynamic: 1 });
  });

  it("writes rules the static host counts as static, two per old slug", () => {
    const redirects = Array.from({ length: 50 }, (_, i) => ({ old_slug: `old-${i}`, new_slug: "amber" }));
    expect(countRedirects(renderRedirects(staticRules, redirects))).toEqual({ static: 1 + 100, dynamic: 1 });
  });
});
