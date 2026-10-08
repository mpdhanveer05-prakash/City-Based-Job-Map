// Verifies a release tag against its release record (ADR-0025 option C; rules in lib/release.ts verifyReleaseRecord):
//
//   node scripts/release-record.mts --tag <release/...> --commit <sha>
//
// The tag's message names the deploy-production run that created it. This reads that run and its environment approvals
// from the GitHub API (GITHUB_TOKEN with actions: read, GITHUB_REPOSITORY; GITHUB_API_URL for a test stand-in) and refuses
// unless the run deployed exactly this commit from main, succeeded, was started by a person, and was approved for
// `production`. Writes run_id to $GITHUB_OUTPUT. Exit 1 when the record does not hold up.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { verifyReleaseRecord } from "../lib/release.ts";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const tag = option("--tag");
const commit = option("--commit");
const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
if (!tag || !commit || !token || !repository) {
  console.error("usage: GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/name node scripts/release-record.mts --tag <release/...> --commit <sha>");
  process.exit(2);
}
const api = (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, "");
const message = execFileSync("git", ["tag", "-l", "--format=%(contents)", tag], { encoding: "utf8" });
const get = async (path: string): Promise<unknown> => {
  const r = await fetch(`${api}/repos/${repository}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  return r.ok ? r.json() : null;
};
const runId = /\/actions\/runs\/(\d+)\b/.exec(message)?.[1];
const [run, approvals] = runId ? await Promise.all([get(`/actions/runs/${runId}`), get(`/actions/runs/${runId}/approvals`)]) : [null, null];
const result = verifyReleaseRecord({ tag: { name: tag, commit, message }, repository, run, approvals });
if (result.problems.length) {
  console.error(`The release record for ${tag} does not hold up:\n${result.problems.map((p) => `  - ${p}`).join("\n")}`);
  // exitCode, not exit(): exiting while fetch keeps its sockets open can crash Node on Windows (0xC0000409).
  process.exitCode = 1;
} else {
  console.log(`${tag}: deploy-production run ${result.runId} deployed ${commit} from main, succeeded, and was approved for production.`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run_id=${result.runId}\n`);
}
