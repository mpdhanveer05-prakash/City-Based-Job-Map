import { describe, expect, it } from "vitest";
import { evaluateAudit, type AuditException, type AuditReport } from "@/lib/audit-gate";

const BRACES = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";
const report = (extra: AuditReport["vulnerabilities"] = {}): AuditReport => ({
  vulnerabilities: {
    braces: { name: "braces", severity: "high", via: [{ source: 1, name: "braces", url: BRACES, severity: "high" }] },
    micromatch: { name: "micromatch", severity: "high", via: ["braces"] },
    "fast-glob": { name: "fast-glob", severity: "high", via: ["micromatch"] },
    ...extra,
  },
});
const entry = (over: Partial<AuditException> = {}): AuditException => ({
  advisory: "GHSA-vfj7-8cjw-p6xm",
  package: "braces",
  allowedVia: ["braces", "micromatch", "fast-glob"],
  exposure: "lint only",
  mitigation: "none needed",
  reviewer: "r",
  owner: "o",
  reviewedOn: "2026-10-06",
  expires: "2027-01-04",
  ...over,
});
const run = (r: AuditReport, e: AuditException[], today = "2026-10-06") => evaluateAudit(r, { exceptions: e }, today);

describe("audit gate (ADR-0019)", () => {
  it("passes when every high finding is covered by a current exception", () => {
    const out = run(report(), [entry()]);
    expect(out.problems).toEqual([]);
    expect(out.covered).toHaveLength(3);
  });

  it("blocks with no exception", () => {
    expect(run(report(), []).problems).toHaveLength(3);
  });

  it("keeps an unrelated finding blocking", () => {
    const out = run(report({ "source-map-js": { name: "source-map-js", severity: "high", via: [{ url: "https://github.com/advisories/GHSA-68fv-2mgg-jv7q" }] } }), [entry()]);
    expect(out.problems).toEqual([expect.stringContaining("source-map-js")]);
  });

  it("blocks the excepted advisory reached through a package not on the reviewed path", () => {
    const out = run(report({ shadcn: { name: "shadcn", severity: "high", via: ["fast-glob"] } }), [entry()]);
    expect(out.problems).toEqual([expect.stringContaining("shadcn")]);
  });

  it("ignores moderate and low findings", () => {
    expect(run(report({ x: { name: "x", severity: "moderate", via: [{ url: "GHSA-aaaa-bbbb-cccc" }] } }), [entry()]).problems).toEqual([]);
  });

  it("fails an expired exception", () => {
    expect(run(report(), [entry()], "2027-01-05").problems.some((p) => p.includes("expired"))).toBe(true);
  });

  it("fails an exception longer than 90 days", () => {
    expect(run(report(), [entry({ expires: "2027-01-05" })]).problems.some((p) => p.includes("more than 90 days"))).toBe(true);
  });

  it("fails an exception without an owner or mitigation", () => {
    expect(run(report(), [entry({ owner: " ", mitigation: "" })]).problems[0]).toContain("missing mitigation, owner");
  });

  it("fails a stale exception", () => {
    expect(run({ vulnerabilities: {} }, [entry()]).problems).toEqual([expect.stringContaining("stale")]);
  });
});
