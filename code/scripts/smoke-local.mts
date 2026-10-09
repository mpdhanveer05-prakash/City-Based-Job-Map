// Runs the deployment smoke suite (tests/smoke) against the build in out/, served on this machine exactly as the Worker
// will serve it (wrangler dev: the same _headers, _redirects and 404 page), BEFORE anything is deployed (DEP-4):
//
//   EXPECT_DEPLOY_TARGET=staging [EXPECT_COMMIT=<sha>] node scripts/smoke-local.mts [--port 8791]
//
// Exit 0 only if the whole suite passes. The server is stopped afterwards either way.
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const at = args.indexOf("--port");
const port = at >= 0 ? Number(args[at + 1]) : 8791;
if (!process.env.EXPECT_DEPLOY_TARGET) {
  console.error("smoke-local: set EXPECT_DEPLOY_TARGET (production, staging or staging-synthetic)");
  process.exit(2);
}
const base = `http://127.0.0.1:${port}`;
const shell = process.platform === "win32";
const server = spawn("npx", ["wrangler", "dev", "--port", String(port), "--ip", "127.0.0.1"], { stdio: ["ignore", "pipe", "pipe"], shell });
let log = "";
server.stdout.on("data", (d) => (log += String(d)));
server.stderr.on("data", (d) => (log += String(d)));

const stop = () =>
  new Promise<void>((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once("exit", () => resolve());
    if (shell && server.pid) spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else server.kill("SIGTERM");
  });

let code = 1;
try {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/build-info.json`)).ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`The local server did not start on ${base}:\n${log.slice(-2000)}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`smoke-local: serving out/ on ${base}; running the smoke suite for ${process.env.EXPECT_DEPLOY_TARGET}`);
  code = await new Promise<number>((resolve) => {
    // With a shell (Windows) arguments are joined into one command line, so one with spaces (a -g title) is quoted.
    const passOn = args.filter((a, i) => a !== "--port" && args[i - 1] !== "--port").map((a) => (shell && /\s/.test(a) ? `"${a}"` : a));
    const run = spawn("npx", ["playwright", "test", "--config", "playwright.smoke.config.ts", ...passOn], {
      stdio: "inherit",
      shell,
      env: { ...process.env, PLAYWRIGHT_BASE_URL: base },
    });
    run.on("exit", (c) => resolve(c ?? 1));
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  await stop();
}
process.exitCode = code;
