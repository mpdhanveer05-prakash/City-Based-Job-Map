import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/design/contrast";
import { CONTRAST_PAIRS } from "@/lib/design/tokens";

const css = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);

function readRootTokens(source: string): Map<string, string> {
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(source);
  if (!root) throw new Error("No :root block in globals.css");
  const tokens = new Map<string, string>();
  for (const [, name, value] of root[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens.set(name, value.trim());
  }
  return tokens;
}

const tokens = readRootTokens(css);

function resolve(name: string, seen: string[] = []): string {
  if (name === "white") return "#ffffff";
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`Token --${name} is not defined`);
  const ref = /^var\(--([\w-]+)\)$/.exec(value);
  if (!ref) return value;
  if (seen.includes(name)) throw new Error(`Cycle in --${name}`);
  return resolve(ref[1], [...seen, name]);
}

describe("brand colours", () => {
  it("keeps the confirmed Milky and Mantis values", () => {
    expect(resolve("milky").toLowerCase()).toBe("#fffdf1");
    expect(resolve("mantis").toLowerCase()).toBe("#59c749");
  });
});

describe("design-system contrast pairs", () => {
  it.each(CONTRAST_PAIRS.map((p) => [p.fg, p.bg, p.min, p.use] as const))(
    "%s on %s is at least %s:1 (%s)",
    (fg, bg, min) => {
      expect(contrastRatio(resolve(fg), resolve(bg))).toBeGreaterThanOrEqual(min);
    },
  );
});

describe("shadcn role pairs", () => {
  const rolePairs = [
    ["foreground", "background"],
    ["card-foreground", "card"],
    ["popover-foreground", "popover"],
    ["primary-foreground", "primary"],
    ["secondary-foreground", "secondary"],
    ["muted-foreground", "muted"],
    ["muted-foreground", "background"],
    ["accent-foreground", "accent"],
    ["link", "background"],
    ["sidebar-foreground", "sidebar"],
    ["sidebar-primary-foreground", "sidebar-primary"],
    ["sidebar-accent-foreground", "sidebar-accent"],
  ] as const;

  it.each(rolePairs)("--%s on --%s is at least 4.5:1", (fg, bg) => {
    expect(contrastRatio(resolve(fg), resolve(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it("puts Ink, not white, on the Mantis primary", () => {
    expect(resolve("primary-foreground")).toBe(resolve("ink"));
  });

  it("uses a focus ring with at least 3:1 against the page and the primary fill", () => {
    expect(contrastRatio(resolve("ring"), resolve("background"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(resolve("ring"), resolve("primary"))).toBeGreaterThanOrEqual(3);
  });
});
