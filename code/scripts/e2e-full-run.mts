// The full e2e suite (`npm run test:e2e`, both projects) as a recorded local run. On 8 Oct 2026 it took 19 min with two
// workers; on 9 Oct a run on a busy laptop took about 8 hours and lost its summary when the session that started it ended.
// This keeps every record outside the session:
//
//   node scripts/e2e-full-run.mts [--workers 2] [--allow-dirty] [-- <more playwright args>]
//   node scripts/e2e-full-run.mts summarize <run folder>      (re-derives the summary, e.g. after an interrupted run)
//
// Each run gets ../.local-test-runs/<time>-<commit>/ (git-ignored):
//   run.json         the commit tested, the tree's state, the settings, and the machine's state at the start
//   console.log      everything the run printed
//   progress.jsonl   one line per test as it starts and ends (tests/reporters/progress-reporter.ts)
//   resources.jsonl  free memory and CPU load once a minute
//   summary.json/.md pass, fail, flaky and skip counts, the tests that never finished or never started, and each failure
//
// It refuses to start while a server answers on the e2e port (the config would reuse it and test an old build), or while
// tracked files differ from the commit (the result would not belong to a commit), unless --allow-dirty.
// Map-heavy specs keep their own serialisation (tests/map-slot.ts) whatever the worker count.
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CODE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNS = path.resolve(CODE, "..", ".local-test-runs");
const E2E_PORT = 3100;
const shell = process.platform === "win32";

type ProgressLine = {
  event: "begin" | "start" | "end" | "done";
  at: string;
  id?: string;
  total?: number;
  tests?: Array<{ id: string; project: string; file: string; title: string }>;
  project?: string;
  file?: string;
  title?: string;
  status?: string;
  outcome?: string;
  retry?: number;
  durationMs?: number;
  error?: string;
};

const git = (...args: string[]) => execFileSync("git", args, { cwd: CODE, encoding: "utf8" }).trim();

/** CPU busy share over a short window (os.loadavg is always 0 on Windows). */
async function cpuBusy(ms = 2000): Promise<number> {
  const sample = () => os.cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, total: a.total + Object.values(c.times).reduce((x, y) => x + y, 0) }), { idle: 0, total: 0 });
  const a = sample();
  await new Promise((r) => setTimeout(r, ms));
  const b = sample();
  const total = b.total - a.total;
  return total > 0 ? Math.round((1 - (b.idle - a.idle) / total) * 100) : 0;
}

const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);

/** The ten processes holding the most memory, by name (what else the machine was doing). */
function topProcesses(): Array<{ name: string; count: number; mb: number }> {
  try {
    const rows =
      process.platform === "win32"
        ? execFileSync("tasklist", ["/fo", "csv", "/nh"], { encoding: "utf8" })
            .split(/\r?\n/)
            .filter(Boolean)
            .map((l) => l.split('","').map((c) => c.replace(/"/g, "")))
            .map((c) => ({ name: c[0], kb: Number(c[4].replace(/[^\d]/g, "")) }))
        : execFileSync("ps", ["-eo", "comm=,rss="], { encoding: "utf8" })
            .split("\n")
            .filter(Boolean)
            .map((l) => l.trim().split(/\s+(?=\d+$)/))
            .map(([name, kb]) => ({ name, kb: Number(kb) }));
    const byName = new Map<string, { count: number; kb: number }>();
    for (const r of rows) {
      const e = byName.get(r.name) ?? { count: 0, kb: 0 };
      byName.set(r.name, { count: e.count + 1, kb: e.kb + (r.kb || 0) });
    }
    return [...byName.entries()]
      .map(([name, e]) => ({ name, count: e.count, mb: Math.round(e.kb / 1024) }))
      .sort((a, b) => b.mb - a.mb)
      .slice(0, 10);
  } catch {
    return [];
  }
}

async function portAnswers(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

/** Reads progress.jsonl (and run.json, resources.jsonl if present) and writes summary.json and summary.md. */
function summarize(dir: string, exitCode?: number | null) {
  const lines = readFileSync(path.join(dir, "progress.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ProgressLine);
  const run = existsSync(path.join(dir, "run.json")) ? JSON.parse(readFileSync(path.join(dir, "run.json"), "utf8")) : {};
  const begin = lines.find((l) => l.event === "begin");
  const done = lines.find((l) => l.event === "done");
  const ends = new Map<string, ProgressLine>(); // the last result of each test (after any retry)
  const started = new Set<string>();
  for (const l of lines) {
    if (l.event === "start" && l.id) started.add(l.id);
    if (l.event === "end" && l.id) ends.set(l.id, l);
  }
  const all = begin?.tests ?? [];
  const finished = [...ends.values()];
  const count = (outcome: string) => finished.filter((e) => e.outcome === outcome).length;
  const neverFinished = all.filter((t) => started.has(t.id) && !ends.has(t.id));
  const neverStarted = all.filter((t) => !started.has(t.id));
  const byProject: Record<string, Record<string, number>> = {};
  for (const e of finished) {
    const p = (byProject[e.project ?? ""] ??= {});
    p[e.outcome ?? "?"] = (p[e.outcome ?? "?"] ?? 0) + 1;
  }
  const failures = finished
    .filter((e) => e.outcome === "unexpected" || e.outcome === "flaky")
    .map((e) => ({ project: e.project, file: e.file, title: e.title, outcome: e.outcome, status: e.status, durationMs: e.durationMs, error: e.error?.split("\n").slice(0, 6).join("\n") }));
  const resourcesFile = path.join(dir, "resources.jsonl");
  const resources = existsSync(resourcesFile)
    ? readFileSync(resourcesFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { freeMb: number; cpuBusy: number })
    : [];
  const summary = {
    commit: run.commit,
    dirty: run.dirty,
    workers: run.workers,
    startedAt: run.startedAt ?? begin?.at,
    finishedAt: done?.at ?? null,
    playwrightStatus: done?.status ?? "no verdict: the run did not finish",
    exitCode: exitCode ?? null,
    total: all.length,
    passed: count("expected"),
    failed: count("unexpected"),
    flaky: count("flaky"),
    skipped: count("skipped"),
    timedOut: finished.filter((e) => e.status === "timedOut").length,
    interrupted: finished.filter((e) => e.status === "interrupted").length,
    neverFinished: neverFinished.map((t) => `${t.project} › ${t.file} › ${t.title}`),
    neverStarted: neverStarted.length,
    byProject,
    resources: resources.length
      ? { minFreeMb: Math.min(...resources.map((r) => r.freeMb)), maxCpuBusy: Math.max(...resources.map((r) => r.cpuBusy)), samples: resources.length }
      : null,
    failures,
  };
  writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  const md = [
    `# e2e run ${path.basename(dir)}`,
    "",
    `- Commit: \`${summary.commit}\`${summary.dirty?.length ? ` (with ${summary.dirty.length} changed tracked files)` : " (clean tree)"}`,
    `- Workers: ${summary.workers}; started ${summary.startedAt}; finished ${summary.finishedAt ?? "never"}`,
    `- Playwright: ${summary.playwrightStatus}; exit code ${summary.exitCode ?? "unknown"}`,
    `- Tests: ${summary.total}. Passed ${summary.passed}, failed ${summary.failed} (timed out ${summary.timedOut}), flaky ${summary.flaky}, skipped ${summary.skipped}, interrupted ${summary.interrupted}, never finished ${summary.neverFinished.length}, never started ${summary.neverStarted}`,
    `- By project: ${Object.entries(byProject).map(([p, c]) => `${p} ${JSON.stringify(c)}`).join("; ")}`,
    summary.resources ? `- Resources: lowest free memory ${summary.resources.minFreeMb} MB, highest CPU load ${summary.resources.maxCpuBusy}% (${summary.resources.samples} samples)` : "- Resources: not sampled",
    "",
    ...(failures.length ? ["## Failures", "", ...failures.map((f) => `- **${f.project} › ${f.file} › ${f.title}** (${f.outcome}, ${f.status}, ${f.durationMs} ms)\n\n  \`\`\`\n${(f.error ?? "").replace(/^/gm, "  ")}\n  \`\`\``)] : []),
    ...(summary.neverFinished.length ? ["", "## Never finished", "", ...summary.neverFinished.map((t) => `- ${t}`)] : []),
    "",
  ].join("\n");
  writeFileSync(path.join(dir, "summary.md"), md);
  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "summarize") {
    if (!args[1]) throw new Error("summarize needs the run folder");
    const s = summarize(path.resolve(args[1]));
    console.log(readFileSync(path.join(path.resolve(args[1]), "summary.md"), "utf8"));
    process.exitCode = s.failed > 0 || s.neverFinished.length > 0 ? 1 : 0;
    return;
  }
  const dash = args.indexOf("--");
  const own = dash >= 0 ? args.slice(0, dash) : args;
  // With a shell (Windows) arguments are joined into one command line, so one with spaces (a -g title) is quoted.
  const passOn = (dash >= 0 ? args.slice(dash + 1) : []).map((a) => (shell && /\s/.test(a) ? `"${a}"` : a));
  const at = own.indexOf("--workers");
  const workers = at >= 0 ? Number(own[at + 1]) : 2;
  if (!Number.isInteger(workers) || workers < 1) throw new Error("--workers needs a whole number of at least 1");

  if (await portAnswers(E2E_PORT)) {
    throw new Error(`Something already answers on port ${E2E_PORT}. The e2e config would reuse it and test that build, not this commit: stop it first.`);
  }
  const dirty = git("status", "--porcelain", "--untracked-files=no").split("\n").filter(Boolean);
  if (dirty.length && !own.includes("--allow-dirty")) {
    throw new Error(`Tracked files differ from the commit, so the result would not belong to it:\n${dirty.join("\n")}\nCommit them, or pass --allow-dirty.`);
  }

  const commit = git("rev-parse", "HEAD");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const dir = path.join(RUNS, `${stamp}-${commit.slice(0, 7)}`);
  mkdirSync(dir, { recursive: true });
  const run = {
    commit,
    subject: git("log", "-1", "--format=%s"),
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    dirty,
    workers,
    mapSlots: Number(process.env.MAP_SLOTS ?? 1),
    extraArgs: passOn,
    node: process.version,
    playwright: execFileSync("npx", ["playwright", "--version"], { cwd: CODE, encoding: "utf8", shell }).trim(),
    machine: { platform: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMb: mb(os.totalmem()) },
    atStart: { freeMb: mb(os.freemem()), cpuBusy: await cpuBusy(), topProcesses: topProcesses() },
    startedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(dir, "run.json"), JSON.stringify(run, null, 2) + "\n");
  console.log(`e2e-full-run: ${dir}\n  commit ${commit}, ${workers} workers, ${run.atStart.freeMb} MB free, CPU ${run.atStart.cpuBusy}% busy`);

  const sampler = setInterval(async () => {
    appendFileSync(path.join(dir, "resources.jsonl"), JSON.stringify({ at: new Date().toISOString(), freeMb: mb(os.freemem()), cpuBusy: await cpuBusy(1000) }) + "\n");
  }, 60_000);

  const consoleLog = createWriteStream(path.join(dir, "console.log"), { flags: "a" });
  // Relative to CODE (the child's cwd): the repository's path has spaces, which a Windows shell would split.
  const child = spawn("npx", ["playwright", "test", `--workers=${workers}`, "--reporter=list,./tests/reporters/progress-reporter.ts", ...passOn], {
    cwd: CODE,
    shell,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PROGRESS_FILE: path.join(dir, "progress.jsonl"), FORCE_COLOR: "0" },
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (d: Buffer) => {
      consoleLog.write(d);
      process.stdout.write(d);
    });
  }
  const code = await new Promise<number | null>((resolve) => child.on("exit", (c) => resolve(c)));
  clearInterval(sampler);
  await new Promise<void>((resolve) => consoleLog.end(() => resolve()));
  const finishedAt = new Date().toISOString();
  writeFileSync(path.join(dir, "run.json"), JSON.stringify({ ...run, finishedAt, exitCode: code, atEnd: { freeMb: mb(os.freemem()) } }, null, 2) + "\n");
  if (!existsSync(path.join(dir, "progress.jsonl"))) {
    console.error("e2e-full-run: the run recorded no test (see console.log)");
    process.exitCode = code ?? 1;
    return;
  }
  summarize(dir, code);
  console.log(readFileSync(path.join(dir, "summary.md"), "utf8"));
  process.exitCode = code ?? 1;
}

await main();
