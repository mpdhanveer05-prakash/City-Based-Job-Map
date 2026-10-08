import { describe, expect, it } from "vitest";
import { RELEASE_TAGGER_EMAIL, baselineFrom, chooseRelease, deployedVersionId, evaluateRefresh, releaseTagName, verifyReleaseRecord, type TagRecord } from "@/lib/release";
import type { Manifest } from "@/lib/filters/dataset-files";

const SHA = "a".repeat(40);
const tag = (over: Partial<TagRecord> = {}): TagRecord => ({
  name: "release/20261101-0930-12",
  objectType: "tag",
  taggerEmail: RELEASE_TAGGER_EMAIL,
  commit: SHA,
  created: "2026-11-01T09:31:00Z",
  onMain: true,
  ...over,
});

function manifest(cities: Record<string, { v: string; companies: number; jobs: number; synthetic?: boolean }>): Manifest {
  const out: Manifest = { version: 1, cities: {} };
  for (const [city, c] of Object.entries(cities)) {
    out.cities[city] = {
      data_version: 1,
      dataset_version: c.v,
      synthetic: c.synthetic ?? false,
      counts: { companies: c.companies, offices: c.companies, jobs: c.jobs },
      evidence_incomplete: { companies: 0, jobs: 0 },
      files: {} as Manifest["cities"][string]["files"],
    };
  }
  return out;
}

describe("release tag names", () => {
  it("are the UTC date and time and the run number", () => {
    expect(releaseTagName(new Date("2026-11-01T04:05:59+05:30"), 7)).toBe("release/20261031-2235-7");
  });
  it("refuse a bad run number", () => {
    expect(() => releaseTagName(new Date(), 0)).toThrow();
  });
});

describe("choosing the release to refresh", () => {
  it("does nothing before the first release", () => {
    expect(chooseRelease([{ ...tag(), name: "v1.0" }]).kind).toBe("none");
  });

  it("takes the newest valid release tag", () => {
    const older = tag({ name: "release/20261020-1000-3", created: "2026-10-20T10:01:00Z" });
    const newer = tag();
    const choice = chooseRelease([older, newer]);
    expect(choice).toEqual({ kind: "release", tag: newer });
  });

  it.each([
    ["a lightweight tag", { objectType: "commit" }, "not an annotated tag"],
    ["another tagger", { taggerEmail: "someone@example.com" }, "not created by the production workflow"],
    ["a commit not on main", { onMain: false }, "not on main"],
    ["a malformed name", { name: "release/latest" }, "name is not"],
    ["an unreadable commit", { commit: "" }, "commit could not be read"],
  ])("refuses the newest tag when it is %s, and never falls back to an older one", (_label, over, reason) => {
    const older = tag({ name: "release/20261020-1000-3", created: "2026-10-20T10:01:00Z" });
    const choice = chooseRelease([older, tag({ created: "2026-11-02T00:00:00Z", ...over })]);
    expect(choice.kind).toBe("refused");
    expect(choice.kind === "refused" && choice.reason).toContain(reason);
  });
});

describe("whether a refresh may deploy", () => {
  const release = { tag: "release/20261101-0930-12", commit: SHA, runId: "555" };
  const approvedAt = (m: Manifest) => baselineFrom(m, release, { kind: "release", runId: "555", by: "owner", at: "2026-11-01T09:31:00Z" });
  const live = manifest({ bangalore: { v: "4-aaaa", companies: 100, jobs: 400 }, chennai: { v: "4-bbbb", companies: 50, jobs: 100 } });
  const site = (over: Partial<{ manifest: Manifest | null; baseline: ReturnType<typeof approvedAt> | null; commit: string | null }> = {}) => ({
    manifest: live,
    baseline: approvedAt(live),
    commit: SHA,
    ...over,
  });
  const at = (b: { companies: number; jobs: number }, c = { companies: 50, jobs: 100 }, v = "5-") =>
    manifest({ bangalore: { v: `${v}a${b.companies}-${b.jobs}`, ...b }, chennai: { v: "4-bbbb", ...c } });

  it("deploys a changed city, and keeps the approved baseline as it was", () => {
    const d = evaluateRefresh(at({ companies: 101, jobs: 390 }), site(), release);
    expect(d).toMatchObject({ changed: ["bangalore"], problems: [], allowed: [] });
    expect(d.baseline).toEqual(approvedAt(live));
  });

  it("does nothing when every folder is unchanged", () => {
    expect(evaluateRefresh(live, site(), release)).toMatchObject({ changed: [], problems: [] });
  });

  it("stops on a drop of more than 20% in one city's companies or jobs, and names only that city", () => {
    const d = evaluateRefresh(at({ companies: 79, jobs: 400 }, { companies: 60, jobs: 120 }), site(), release);
    expect(d.problems).toHaveLength(1);
    expect(d.problems[0]).toMatch(/^bangalore: companies would drop from 100 to 79 since the last deployment/);
  });

  it("stops when a city drops to zero", () => {
    const d = evaluateRefresh(at({ companies: 100, jobs: 0 }), site(), release);
    expect(d.problems.join()).toContain("bangalore: jobs would drop from 400 to 0");
    // A city that had nothing approved may stay at nothing.
    const empty = manifest({ bangalore: { v: "4-aaaa", companies: 100, jobs: 400 }, chennai: { v: "1-e", companies: 0, jobs: 0 } });
    expect(evaluateRefresh(empty, site({ manifest: empty, baseline: approvedAt(empty) }), release).problems).toEqual([]);
  });

  it("accepts a drop of exactly 20%", () => {
    expect(evaluateRefresh(at({ companies: 80, jobs: 320 }), site(), release).problems).toEqual([]);
  });

  it("stops small successive drops once they add up to more than 20% of what a person approved", () => {
    // Each refresh drops 10% from the one before, so each passes the step check; the baseline does not move.
    let deployed = live;
    const outcomes: number[] = [];
    for (const companies of [90, 81, 73]) {
      const next = at({ companies, jobs: 400 });
      const d = evaluateRefresh(next, site({ manifest: deployed }), release);
      outcomes.push(d.problems.length);
      if (d.problems.length === 0) deployed = next;
    }
    expect(outcomes).toEqual([0, 0, 1]);
    const third = evaluateRefresh(at({ companies: 73, jobs: 400 }), site({ manifest: deployed }), release);
    expect(third.problems[0]).toMatch(/bangalore: companies would be 73, down from 100 when a person last approved \(release, run 555\)/);
  });

  it("deploys a shrink a person allowed, and makes the new counts the approved baseline", () => {
    const next = at({ companies: 73, jobs: 400 });
    const d = evaluateRefresh(next, site(), release, { allowShrink: { runId: "777", by: "reviewer", at: "2026-11-05T10:00:00Z" } });
    expect(d.problems).toEqual([]);
    expect(d.allowed).toHaveLength(1);
    expect(d.baseline).toMatchObject({ approved: { kind: "shrink", runId: "777", by: "reviewer" }, cities: { bangalore: { companies: 73 } } });
    // And the next automatic refresh is measured from there.
    expect(evaluateRefresh(at({ companies: 70, jobs: 400 }, undefined, "6-"), site({ manifest: next, baseline: d.baseline }), release).problems).toEqual([]);
  });

  it("never deploys over a site that is not a build of this release", () => {
    for (const commit of ["b".repeat(40), null]) {
      expect(evaluateRefresh(at({ companies: 101, jobs: 400 }), site({ commit }), release).problems.join()).toMatch(/A newer release may be live without its tag/);
    }
  });

  it("stops without an approved baseline, or with one for another release", () => {
    expect(evaluateRefresh(live, site({ baseline: null }), release).problems.join()).toContain("no approved baseline");
    const other = { ...approvedAt(live), release: { ...release, tag: "release/20261020-1000-3", runId: "444" } };
    expect(evaluateRefresh(live, site({ baseline: other }), release).problems.join()).toContain(`is for release/20261020-1000-3 (${SHA.slice(0, 12)}, run 444), not for release/20261101-0930-12 (${SHA.slice(0, 12)}, run 555)`);
  });

  it("never deploys or refreshes a pilot preview build (simulated reviews), built or live", () => {
    const preview = { ...at({ companies: 100, jobs: 400 }), pilot_preview: true as const };
    expect(evaluateRefresh(preview, site(), release).problems.join()).toContain("pilot preview");
    expect(evaluateRefresh(at({ companies: 100, jobs: 400 }), site({ manifest: { ...live, pilot_preview: true } }), release).problems.join()).toContain("pilot preview");
  });

  it("stops on synthetic data, a missing live city, a new city, or an unreadable deployed manifest", () => {
    const synthetic = manifest({ bangalore: { v: "5-x", companies: 100, jobs: 400, synthetic: true }, chennai: { v: "4-bbbb", companies: 50, jobs: 100 } });
    expect(evaluateRefresh(synthetic, site(), release).problems.join()).toContain("synthetic");
    expect(evaluateRefresh(manifest({ bangalore: { v: "4-aaaa", companies: 100, jobs: 400 } }), site(), release).problems.join()).toContain("chennai is live but missing");
    const added = manifest({ bangalore: { v: "4-aaaa", companies: 100, jobs: 400 }, chennai: { v: "4-bbbb", companies: 50, jobs: 100 }, pune: { v: "1-e", companies: 5, jobs: 5 } });
    expect(evaluateRefresh(added, site(), release).problems.join()).toContain("pune: a city goes live only through a release");
    expect(evaluateRefresh(live, site({ manifest: null }), release).problems.join()).toContain("could not be read");
  });
});

describe("the release record", () => {
  const commit = SHA;
  const tagRef = { name: "release/20261101-0930-12", commit, message: "Production release of x\n\nRun: https://github.com/o/r/actions/runs/555\n" };
  const run = {
    id: 555, path: ".github/workflows/deploy-production.yml", repository: { full_name: "o/r" }, status: "completed",
    conclusion: "success", head_sha: commit, head_branch: "main", event: "workflow_dispatch",
  };
  const approvals = [{ state: "approved", environments: [{ name: "production" }], user: { login: "owner" } }];
  const verify = (over: Partial<{ tag: typeof tagRef; run: unknown; approvals: unknown }> = {}) =>
    verifyReleaseRecord({ tag: tagRef, repository: "o/r", run, approvals, ...over });

  it("holds up for a successful, approved production run that deployed the tag's commit from main", () => {
    expect(verify()).toEqual({ runId: "555", problems: [] });
  });

  it.each([
    ["another workflow", { path: ".github/workflows/deploy-staging.yml" }, "not the production release workflow"],
    ["a failed run", { conclusion: "failure" }, "did not succeed"],
    ["a run still going", { status: "in_progress", conclusion: null }, "did not succeed"],
    ["another commit", { head_sha: "c".repeat(40) }, "not the tag's commit"],
    ["another branch", { head_branch: "feature" }, "not main"],
    ["a scheduled run", { event: "schedule" }, "not by a person"],
    ["another repository", { repository: { full_name: "fork/r" } }, "belongs to fork/r"],
  ])("refuses %s", (_label, change, reason) => {
    expect(verify({ run: { ...run, ...change } }).problems.join()).toContain(reason);
  });

  it("refuses a run nobody approved for production, or approved only elsewhere", () => {
    expect(verify({ approvals: [] }).problems.join()).toContain("no reviewer's approval");
    expect(verify({ approvals: [{ state: "rejected", environments: [{ name: "production" }] }] }).problems.join()).toContain("no reviewer's approval");
    expect(verify({ approvals: [{ state: "approved", environments: [{ name: "staging" }] }] }).problems.join()).toContain("no reviewer's approval");
  });

  it("refuses a tag that names no run, or a run that cannot be read", () => {
    expect(verify({ tag: { ...tagRef, message: "release" } }).problems.join()).toContain("names no deploy-production run");
    expect(verify({ run: null }).problems.join()).toContain("could not be read");
  });
});

describe("the deployed Worker version", () => {
  const id = "0f3c2a5e-1b2c-4d5e-8f90-123456789abc";
  it("is the version serving all traffic", () => {
    expect(deployedVersionId({ versions: [{ version_id: id, percentage: 100 }] })).toBe(id);
  });
  it.each([null, {}, { versions: [] }, { versions: [{ version_id: id, percentage: 50 }, { version_id: id, percentage: 50 }] }, { versions: [{ version_id: "nope", percentage: 100 }] }])(
    "is an error for anything else (%j)",
    (json) => {
      expect(() => deployedVersionId(json)).toThrow();
    },
  );
});
