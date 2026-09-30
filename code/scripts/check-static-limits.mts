// Fails the build when out/ would break a Workers static assets Free limit (ADR-0006/0007),
// or when it contains something that looks like a secret.
// Runs after `next build` (npm "postbuild"); Node 24 executes this file directly.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Workers static assets Free limits, checked 2026-09-30 (developers.cloudflare.com/workers/platform/limits,
// .../static-assets/redirects, .../static-assets/headers).
export const LIMITS = {
  files: 20_000,
  // D-10: jobs have their own page (Option A, 10 files per company). Past this
  // count, plan the switch to Option B (jobs on the company page, 5 files each).
  fileWarn: 15_000,
  fileGuard: 18_000, // fail early, leaving headroom for growth
  fileBytes: 25 * 1024 * 1024,
  staticRedirects: 2_000,
  dynamicRedirects: 100,
  headerRules: 100,
} as const;

export type Limits = { readonly [K in keyof typeof LIMITS]: number };

const SECRET_PATTERNS: readonly RegExp[] = [
  /service_role/i,
  /\bsb_secret_[A-Za-z0-9_-]{10,}/,
  /SUPABASE_SERVICE_ROLE_KEY/,
  /TURNSTILE_SECRET_KEY/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export type RedirectCounts = { static: number; dynamic: number };

/** Counts _redirects rules. A rule with a splat (*) or a :placeholder is dynamic. */
export function countRedirects(text: string): RedirectCounts {
  const counts = { static: 0, dynamic: 0 };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [source = "", destination = ""] = line.split(/\s+/);
    const dynamic = /[*]|\/:[A-Za-z]/.test(source) || /:[A-Za-z]/.test(destination);
    counts[dynamic ? "dynamic" : "static"] += 1;
  }
  return counts;
}

/** Counts _headers rules: every non-indented, non-comment line starts a URL rule. */
export function countHeaderRules(text: string): number {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "" && !/^\s/.test(line) && !line.startsWith("#")).length;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

export type Report = {
  files: number;
  largest: { file: string; bytes: number };
  redirects: RedirectCounts;
  headerRules: number;
  problems: string[];
  warnings: string[];
};

export function checkOutput(outDir: string, limits: Limits = LIMITS): Report {
  const files = walk(outDir);
  const problems: string[] = [];
  const warnings: string[] = [];
  let largest = { file: "", bytes: 0 };

  for (const file of files) {
    const { size } = statSync(file);
    if (size > largest.bytes) largest = { file: path.relative(outDir, file), bytes: size };
    if (size >= limits.fileBytes) {
      problems.push(`${path.relative(outDir, file)} is ${size} bytes (limit 25 MiB)`);
    }
    if (/\.(html|js|txt|json|xml|css|map)$/.test(file)) {
      const text = readFileSync(file, "utf8");
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(text)) {
          problems.push(`${path.relative(outDir, file)} matches secret pattern ${pattern}`);
        }
      }
    }
  }
  if (files.length > limits.fileGuard) {
    problems.push(`${files.length} files (guard ${limits.fileGuard}, limit ${limits.files})`);
  } else if (files.length > limits.fileWarn) {
    warnings.push(
      `${files.length} files is past the D-10 warning level (${limits.fileWarn}). ` +
        "Plan Option B (jobs on the company page, P6-04) before adding more companies or cities.",
    );
  }

  const read = (name: string) => {
    try {
      return readFileSync(path.join(outDir, name), "utf8");
    } catch {
      return "";
    }
  };
  const redirects = countRedirects(read("_redirects"));
  if (redirects.static > limits.staticRedirects) {
    problems.push(`${redirects.static} static redirects (limit ${limits.staticRedirects})`);
  }
  if (redirects.dynamic > limits.dynamicRedirects) {
    problems.push(`${redirects.dynamic} dynamic redirects (limit ${limits.dynamicRedirects})`);
  }
  const headerRules = countHeaderRules(read("_headers"));
  if (headerRules > limits.headerRules) {
    problems.push(`${headerRules} header rules (limit ${limits.headerRules})`);
  }

  return { files: files.length, largest, redirects, headerRules, problems, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outDir = path.resolve(process.argv[2] ?? "out");
  const report = checkOutput(outDir);
  console.log(
    `Static asset limits: ${report.files}/${LIMITS.files} files, largest ${report.largest.file} ` +
      `(${(report.largest.bytes / 1024).toFixed(1)} KiB), redirects ${report.redirects.static} static + ` +
      `${report.redirects.dynamic} dynamic, ${report.headerRules} header rules`,
  );
  for (const warning of report.warnings) console.warn(`Warning: ${warning}`);
  if (report.problems.length > 0) {
    console.error(`Static output check failed:\n- ${report.problems.join("\n- ")}`);
    process.exit(1);
  }
}
