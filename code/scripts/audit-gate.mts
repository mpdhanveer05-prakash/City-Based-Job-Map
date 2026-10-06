// The blocking dependency audit (ADR-0019, P9-09). Runs `npm audit --json` over every dependency and fails on any
// high or critical finding that security/audit-exceptions.json does not cover with a current entry. It also fails on
// an expired entry, an entry whose review is more than 90 days before its expiry, and a stale entry that no longer
// matches any finding. Usage: node scripts/audit-gate.mts [--audit-json <file>] [--today YYYY-MM-DD]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateAudit, type AuditReport, type ExceptionRegister } from "../lib/audit-gate.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

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
const result = evaluateAudit(readAudit(), register, arg("--today") ?? new Date().toISOString().slice(0, 10));

for (const line of result.covered) console.log(`excepted: ${line}`);
for (const line of result.problems) console.error(`FAIL: ${line}`);
console.log(result.problems.length === 0 ? "Audit gate: pass." : `Audit gate: ${result.problems.length} problem(s).`);
process.exit(result.problems.length === 0 ? 0 : 1);
