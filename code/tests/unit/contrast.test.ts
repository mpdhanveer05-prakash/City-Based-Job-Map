import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";
import { contrastRatio, hexToRgb } from "@/lib/design/contrast";

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#59c749", "#fffdf1")).toBe(contrastRatio("#fffdf1", "#59c749"));
  });

  it("confirms Mantis on Milky is unusable for text (docs/design-system.md §1)", () => {
    expect(contrastRatio("#59c749", "#fffdf1")).toBeCloseTo(2.12, 2);
  });

  it("rejects malformed hex such as the five-digit #FFDF1", () => {
    expect(() => hexToRgb("#FFDF1")).toThrow();
  });
});

describe("cn", () => {
  // Custom colour tokens must not be mistaken for font sizes when classes merge.
  it("keeps a custom text colour next to a font size", () => {
    expect(cn("text-base", "text-link").split(" ").sort()).toEqual(["text-base", "text-link"]);
    expect(cn("text-sm text-primary-foreground").split(" ").sort()).toEqual([
      "text-primary-foreground",
      "text-sm",
    ]);
  });

  it("lets a later utility override an earlier one of the same kind", () => {
    expect(cn("h-11", "h-auto")).toBe("h-auto");
  });
});
