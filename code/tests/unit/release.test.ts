import { describe, expect, it } from "vitest";
import { RELEASE_TAGGER_EMAIL, chooseRelease, compareManifests, deployedVersionId, releaseTagName, type TagRecord } from "@/lib/release";
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

describe("comparing the new build with the deployed manifest", () => {
  const live = manifest({ bangalore: { v: "4-aaaa", companies: 100, jobs: 400 }, chennai: { v: "4-bbbb", companies: 50, jobs: 100 } });

  it("finds nothing to deploy when every folder is unchanged", () => {
    expect(compareManifests(live, live)).toEqual({ changed: [], problems: [], allowed: [] });
  });

  it("lists the cities whose folder changed", () => {
    const next = manifest({ bangalore: { v: "4-cccc", companies: 101, jobs: 390 }, chennai: { v: "4-bbbb", companies: 50, jobs: 100 } });
    expect(compareManifests(live, next)).toEqual({ changed: ["bangalore"], problems: [], allowed: [] });
  });

  it("stops on a drop of more than 20% in companies or jobs, unless a person allows it", () => {
    const next = manifest({ bangalore: { v: "5-dddd", companies: 79, jobs: 400 }, chennai: { v: "4-bbbb", companies: 50, jobs: 79 } });
    const stopped = compareManifests(live, next);
    expect(stopped.problems).toHaveLength(2);
    expect(stopped.problems[0]).toContain("bangalore: companies would drop from 100 to 79");
    const allowed = compareManifests(live, next, { allowShrink: true });
    expect(allowed.problems).toEqual([]);
    expect(allowed.allowed).toHaveLength(2);
  });

  it("accepts a drop of exactly 20%", () => {
    const next = manifest({ bangalore: { v: "5-dddd", companies: 80, jobs: 320 }, chennai: { v: "4-bbbb", companies: 50, jobs: 100 } });
    expect(compareManifests(live, next).problems).toEqual([]);
  });

  it("stops on synthetic data, a missing live city, a new city, or an unreadable deployed manifest", () => {
    const synthetic = manifest({ bangalore: { v: "5-x", companies: 100, jobs: 400, synthetic: true }, chennai: { v: "4-bbbb", companies: 50, jobs: 100 } });
    expect(compareManifests(live, synthetic).problems.join()).toContain("synthetic");
    const missing = manifest({ bangalore: { v: "4-aaaa", companies: 100, jobs: 400 } });
    expect(compareManifests(live, missing).problems.join()).toContain("chennai is live but missing");
    const added = manifest({ ...{ bangalore: { v: "4-aaaa", companies: 100, jobs: 400 } }, chennai: { v: "4-bbbb", companies: 50, jobs: 100 }, pune: { v: "1-e", companies: 5, jobs: 5 } });
    expect(compareManifests(live, added).problems.join()).toContain("pune: a city goes live only through a release");
    expect(compareManifests(null, live).problems.join()).toContain("could not be read");
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
