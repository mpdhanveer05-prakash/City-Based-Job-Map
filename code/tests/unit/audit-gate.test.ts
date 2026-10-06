import { describe, expect, it } from "vitest";
import { approvalOf, evaluateAudit, type AuditException, type AuditReport } from "@/lib/audit-gate";

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

  it("passes an unconfirmed owner, but says so", () => {
    const out = run(report(), [entry()]);
    expect(out.problems).toEqual([]);
    expect(out.notices).toEqual([expect.stringContaining("the owner is not confirmed")]);
    expect(run(report(), [entry({ ownerConfirmed: true })]).notices).toEqual([]);
  });

  it("fails a stale exception", () => {
    expect(run({ vulnerabilities: {} }, [entry()]).problems).toEqual([expect.stringContaining("stale")]);
  });
});

describe("exception approval (ADR-0022)", () => {
  const approved = (over: Partial<NonNullable<AuditException["approval"]>> = {}, extra: Partial<AuditException> = {}) =>
    entry({ ownerConfirmed: true, approval: { status: "approved", approvedBy: "Priya Raman", approvedOn: "2026-10-07", ...over }, ...extra });

  it("is reported apart from the technical result, and pending does not fail CI", () => {
    const out = run(report(), [entry()]);
    expect(out.problems).toEqual([]);
    expect(out.approvals).toEqual([{ advisory: "GHSA-vfj7-8cjw-p6xm", approved: false, reason: "no approval recorded (status pending)" }]);
  });

  it("counts only a named, dated human who is not the assessor, with the owner confirmed", () => {
    expect(approvalOf(approved(), "2026-10-08")).toEqual({ approved: true, reason: "approved by Priya Raman on 2026-10-07" });
    expect(approvalOf(approved({ approvedBy: "Claude Code" }), "2026-10-08").reason).toBe("an AI assessment is not a human approval");
    expect(approvalOf(approved({ approvedBy: "r" }), "2026-10-08").reason).toBe("the approver must not be the assessor");
    expect(approvalOf(approved({ approvedBy: null }), "2026-10-08").reason).toMatch(/needs approvedBy/);
    expect(approvalOf(approved({ approvedOn: "2026-10-09" }), "2026-10-08").reason).toMatch(/between the review and today/);
    expect(approvalOf(approved({}, { ownerConfirmed: false }), "2026-10-08").reason).toBe("the owner is not confirmed");
  });

  it("does not mistake a name containing the letters ai for an AI", () => {
    expect(approvalOf(approved({ approvedBy: "Sai Kailash" }), "2026-10-08").approved).toBe(true);
  });
});
