// The blocking dependency audit (ADR-0019, P9-09) and the approval of its exceptions (ADR-0022), reported separately.
//
//   TECHNICAL  `npm audit --json` over every dependency: fails on any high or critical finding that
//              security/audit-exceptions.json does not cover with a current entry, an expired entry, an entry whose
//              review is more than 90 days before its expiry, and a stale entry that no longer matches any finding.
//   APPROVAL   each exception the technical result relies on: approved only by a person on the owner's list of
//              authorised approvers (security/authorized-approvers.json), who is not the assessor, with the owner
//              confirmed. An AI assessment is not an approval.
//
// CI runs it without flags: the technical audit decides the exit code, and the approval status is printed. A release
// (`--release`, used by the production workflow and the release checklist) also fails while any exception is unapproved,
// so an unapproved exception never counts as a passed release gate.
//
// Usage: node scripts/audit-gate.mts [--release] [--audit-json <file>] [--today YYYY-MM-DD]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateAudit, type AuditReport, type ExceptionRegister } from "../lib/audit-gate.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const release = process.argv.includes("--release");

function readAudit(): AuditReport {
  const file = arg("--audit-json");
  if (file) return JSON.parse(readFileSync(file, "utf8")) as AuditReport;
  try {
    return JSON.parse(execFileSync("npm", ["audit", "--json"], { encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024 })) as AuditReport;
  } catch (error) {
    // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
    const stdout = (error as { stdout?: string }).stdout;
    if (!stdout) throw error;
    return JSON.parse(stdout) as AuditReport;
  }
}

const registerPath = fileURLToPath(new URL("../security/audit-exceptions.json", import.meta.url));
const register = JSON.parse(readFileSync(registerPath, "utf8")) as ExceptionRegister;
const approversPath = fileURLToPath(new URL("../security/authorized-approvers.json", import.meta.url));
const authorised = (JSON.parse(readFileSync(approversPath, "utf8")) as { approvers: string[] }).approvers;
const result = evaluateAudit(readAudit(), register, arg("--today") ?? new Date().toISOString().slice(0, 10), authorised);

console.log("TECHNICAL AUDIT");
for (const line of result.covered) console.log(`  excepted: ${line}`);
for (const line of result.problems) console.error(`  FAIL: ${line}`);
const technicalPass = result.problems.length === 0;
console.log(technicalPass ? "  Technical audit: pass." : `  Technical audit: ${result.problems.length} problem(s).`);

console.log("EXCEPTION APPROVAL");
for (const line of result.notices) console.log(`  NOTICE: ${line}`);
for (const a of result.approvals) console.log(`  ${a.approved ? "approved" : "NOT APPROVED"}: ${a.advisory}: ${a.reason}`);
const unapproved = result.approvals.filter((a) => !a.approved).length;
console.log(unapproved === 0 ? "  Exception approval: every exception is approved." : `  Exception approval: ${unapproved} exception(s) not approved.`);

if (release) {
  const pass = technicalPass && unapproved === 0;
  console.log(pass ? "Release audit gate: pass." : "Release audit gate: FAIL (an unapproved exception does not pass a release).");
  process.exit(pass ? 0 : 1);
}
process.exit(technicalPass ? 0 : 1);
