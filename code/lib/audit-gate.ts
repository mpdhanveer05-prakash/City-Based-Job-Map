// The decision behind the blocking dependency audit (ADR-0019, P9-09). A pure function so the rules are unit-tested;
// scripts/audit-gate.mts feeds it `npm audit --json` and security/audit-exceptions.json.

/** The parts of `npm audit --json` (npm 7+) this reads. */
export interface AuditReport {
  vulnerabilities: Record<
    string,
    {
      name: string;
      severity: "info" | "low" | "moderate" | "high" | "critical";
      via: (string | { source?: number; name?: string; url?: string; severity?: string })[];
    }
  >;
}

export interface AuditException {
  advisory: string;
  package: string;
  /** Packages allowed to be flagged because they lead to `package` (npm lists each step of the chain). */
  allowedVia: string[];
  exposure: string;
  mitigation: string;
  reviewer: string;
  owner: string;
  reviewedOn: string;
  expires: string;
}

export interface ExceptionRegister {
  exceptions: AuditException[];
}

export interface AuditGateResult {
  problems: string[];
  covered: string[];
}

const BLOCKING = new Set(["high", "critical"]);
const MAX_DAYS = 90;
const DAY_MS = 86_400_000;
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const advisoryId = (url: string | undefined) => url?.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i)?.[0];

export function evaluateAudit(report: AuditReport, register: ExceptionRegister, today: string): AuditGateResult {
  const problems: string[] = [];
  const covered: string[] = [];
  const valid: AuditException[] = [];

  for (const e of register.exceptions) {
    const label = `${e.advisory} (${e.package})`;
    const missing = (["exposure", "mitigation", "reviewer", "owner"] as const).filter((k) => !e[k]?.trim());
    if (missing.length > 0) problems.push(`exception ${label} is missing ${missing.join(", ")}.`);
    else if (!isDate(e.reviewedOn) || !isDate(e.expires)) problems.push(`exception ${label} needs reviewedOn and expires as YYYY-MM-DD.`);
    else if (Date.parse(e.expires) - Date.parse(e.reviewedOn) > MAX_DAYS * DAY_MS) problems.push(`exception ${label} expires more than ${MAX_DAYS} days after its review.`);
    else if (e.expires < today) problems.push(`exception ${label} expired on ${e.expires}; review it again or remove the dependency.`);
    else valid.push(e);
  }

  // Direct advisories found: advisory id -> package names reporting it directly.
  const found = new Map<string, Set<string>>();
  for (const v of Object.values(report.vulnerabilities)) {
    for (const via of v.via) {
      if (typeof via === "string") continue;
      const id = advisoryId(via.url);
      if (id) found.set(id, (found.get(id) ?? new Set()).add(v.name));
    }
  }

  for (const v of Object.values(report.vulnerabilities)) {
    if (!BLOCKING.has(v.severity)) continue;
    const direct = v.via.flatMap((via) => (typeof via === "string" ? [] : [advisoryId(via.url) ?? `unknown advisory ${via.source ?? ""}`]));
    const viaPackages = v.via.filter((via): via is string => typeof via === "string");
    const entry = valid.find(
      (e) => e.allowedVia.includes(v.name) && direct.every((id) => id === e.advisory) && viaPackages.every((p) => e.allowedVia.includes(p)),
    );
    if (entry) covered.push(`${v.name} (${v.severity}) under ${entry.advisory}, expires ${entry.expires}`);
    else problems.push(`${v.name} (${v.severity}) ${direct.length > 0 ? direct.join(", ") : `via ${viaPackages.join(", ")}`} has no current exception.`);
  }

  for (const e of valid) {
    if (!found.get(e.advisory)?.has(e.package)) problems.push(`exception ${e.advisory} (${e.package}) is stale: the audit no longer reports it. Remove it.`);
  }
  return { problems, covered };
}
