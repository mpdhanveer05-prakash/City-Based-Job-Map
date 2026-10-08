// Release tags for ADR-0025 option C (rules in lib/release.ts):
//
//   node scripts/release-tag.mts name --run <github.run_number>   prints the tag deploy-production.yml creates
//   node scripts/release-tag.mts resolve                          the newest approved release, for the data refresh
//
// `resolve` needs a checkout with full history and tags, and origin/main fetched. It writes found, tag and commit to
// $GITHUB_OUTPUT when set. Exit 0 with found=false before the first release; exit 1 when the newest tag is refused.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { chooseRelease, releaseTagName, type TagRecord } from "../lib/release.ts";

const [command, ...args] = process.argv.slice(2);
const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8" }).trim();
const output = (pairs: Record<string, string>) => {
  const lines = Object.entries(pairs).map(([k, v]) => `${k}=${v}`);
  console.log(lines.join("\n"));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
};

if (command === "name") {
  const i = args.indexOf("--run");
  console.log(releaseTagName(new Date(), Number(i >= 0 ? args[i + 1] : NaN)));
} else if (command === "resolve") {
  const refs = git("for-each-ref", "--format=%(refname:strip=2)%09%(objecttype)%09%(taggeremail)%09%(*objectname)%09%(objectname)%09%(creatordate:iso-strict)", "refs/tags/release/");
  const tags: TagRecord[] = refs
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, objectType, taggerEmail, peeled, object, created] = line.split("\t");
      const commit = objectType === "tag" ? peeled : object;
      let onMain = false;
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", commit, "origin/main"]);
        onMain = true;
      } catch {
        onMain = false;
      }
      return { name, objectType, taggerEmail: taggerEmail.replace(/^<|>$/g, ""), commit, created, onMain };
    });
  const choice = chooseRelease(tags);
  if (choice.kind === "release") {
    output({ found: "true", tag: choice.tag.name, commit: choice.tag.commit });
  } else {
    console.error(choice.reason);
    output({ found: "false", tag: "", commit: "" });
    process.exit(choice.kind === "refused" ? 1 : 0);
  }
} else {
  console.error("usage: node scripts/release-tag.mts name --run <n> | resolve");
  process.exit(2);
}
