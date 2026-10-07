// A disposable Supabase stack for the database and admin tests, separate from the main local stack (owner, 7 Oct 2026:
// the main local database holds the pilot drafts and must never be reset by a test).
//
//   node scripts/test-stack.mts start [--db-only]   copy supabase/ into .test-stack/, start it, reset it (migrations + seed)
//   node scripts/test-stack.mts reset               re-copy and reset the test stack only
//   node scripts/test-stack.mts test-db             pgTAP against the test stack (refuses anything else)
//   node scripts/test-stack.mts status              the test stack's URLs and keys (local development values)
//   node scripts/test-stack.mts stop                stop it and discard its data
//
// The test stack is the same project with another project_id ("company-map-test"), so it has its own containers and
// volumes, and every port moved up by 1000 (database 55322, API 55321). Its seed adds a marker, test_stack.marker, which
// the test guards (tests/disposable-db.ts, scripts/pipeline/tests/conftest.py) require before they touch a database.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CODE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TEST_WORKDIR = path.join(CODE, ".test-stack");
export const TEST_PROJECT_ID = "company-map-test";
export const TEST_DB_PORT = 55322;
export const TEST_API_PORT = 55321;
export const TEST_DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${TEST_DB_PORT}/postgres`;

// Every port in config.toml, and where it moves to.
const PORTS: Record<number, number> = { 54320: 55320, 54321: 55321, 54322: 55322, 54323: 55323, 54324: 55324, 54327: 55327, 54329: 55329, 8083: 8093 };
const EXCLUDE = "studio,imgproxy,vector,logflare,realtime,pgadmin-schema-diff,migra,postgres-meta";

export const MARKER_SQL = `-- Added only to the disposable test stack by scripts/test-stack.mts. Test guards refuse a database without it.
create schema if not exists test_stack;
create table if not exists test_stack.marker (project_id text primary key, created_at timestamptz not null default now());
insert into test_stack.marker (project_id) values ('${TEST_PROJECT_ID}') on conflict do nothing;
revoke all on schema test_stack from public, anon, authenticated;
`;

/** config.toml for the test stack: another project_id and every port moved. Exported for the unit test. */
export function testConfig(main: string): string {
  let out = main.replace(/^project_id\s*=\s*"[^"]*"/m, `project_id = "${TEST_PROJECT_ID}"`);
  out = out.replace(/^(\s*(?:port|shadow_port|inspector_port)\s*=\s*)(\d+)/gm, (line, head: string, port: string) => {
    const moved = PORTS[Number(port)];
    if (moved === undefined) throw new Error(`test-stack: config.toml has a port ${port} with no test-stack mapping; add it to PORTS`);
    return `${head}${moved}`;
  });
  if (!out.includes(`project_id = "${TEST_PROJECT_ID}"`)) throw new Error("test-stack: could not set project_id in config.toml");
  return out;
}

function sync(): void {
  const src = path.join(CODE, "supabase");
  const dst = path.join(TEST_WORKDIR, "supabase");
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  for (const part of ["migrations", "seed", "functions", "tests"]) {
    if (existsSync(path.join(src, part))) cpSync(path.join(src, part), path.join(dst, part), { recursive: true });
  }
  writeFileSync(path.join(dst, "config.toml"), testConfig(readFileSync(path.join(src, "config.toml"), "utf8")));
  writeFileSync(path.join(dst, "seed", "zz_test_stack_marker.sql"), MARKER_SQL);
}

function supabase(args: string[]): void {
  execFileSync("npx", ["supabase", ...args, "--workdir", ".test-stack"], { cwd: CODE, stdio: "inherit", shell: true });
}

/** The test stack's local status (URLs and the local development keys), as `supabase status -o json` prints it. */
export function testStackStatus(): Record<string, string> {
  const out = execFileSync("npx", ["supabase", "status", "-o", "json", "--workdir", ".test-stack"], { cwd: CODE, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: true });
  return JSON.parse(out.slice(out.indexOf("{"))) as Record<string, string>;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "start":
      sync();
      if (rest.includes("--db-only")) supabase(["db", "start"]);
      else supabase(["start", "-x", EXCLUDE]);
      supabase(["db", "reset"]);
      break;
    case "reset":
      sync();
      supabase(["db", "reset"]);
      break;
    case "test-db": {
      const { assertDisposableDatabase } = await import("../tests/disposable-db.ts");
      await assertDisposableDatabase(TEST_DATABASE_URL);
      sync(); // the current test files (the migrations take effect only with `reset`)
      supabase(["test", "db"]);
      break;
    }
    case "status":
      console.log(JSON.stringify({ DB_URL: TEST_DATABASE_URL, ...testStackStatus() }, null, 2));
      break;
    case "stop":
      supabase(["stop", "--no-backup"]);
      break;
    default:
      console.error("usage: node scripts/test-stack.mts start [--db-only] | reset | test-db | status | stop");
      process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
