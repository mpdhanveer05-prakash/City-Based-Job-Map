// Global setup for playwright.cdp.config.ts: a stand-in for a phone's Chrome reached over `adb forward` (a local Chromium
// with a DevTools endpoint) and a tiny page server for the base URL. Sets GATE_ANDROID_CDP before the workers start, so
// tests/device-test.ts runs in its attachment mode exactly as it does with a phone. Returns the teardown.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { CDP_PORT, PAGE_PORT } from "../../playwright.cdp.config";

export default async function setup() {
  const profile = mkdtempSync(path.join(tmpdir(), "cdp-standin-"));
  const browser = spawn(chromium.executablePath(), ["--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], {
    stdio: "ignore",
  });
  const pages = createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(`<!doctype html><title>stand-in</title><h1>hello from the stand-in server</h1><p data-path="${(req.url ?? "").replace(/[<>"&]/g, "")}"></p>`);
  });
  await new Promise<void>((resolve) => pages.listen(PAGE_PORT, "127.0.0.1", resolve));

  const endpoint = `http://127.0.0.1:${CDP_PORT}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      if ((await fetch(`${endpoint}/json/version`)).ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`The stand-in Chromium did not open its DevTools endpoint on ${endpoint}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  process.env.GATE_ANDROID_CDP = endpoint;

  return async () => {
    await new Promise<void>((resolve) => pages.close(() => resolve()));
    // Chromium runs as a tree of processes, and on Windows killing the parent leaves the children holding the profile
    // (EPERM on removing it, 9 Oct 2026): end the whole tree and wait for the browser to exit before removing it.
    if (browser.exitCode === null && browser.signalCode === null) {
      const exited = new Promise<void>((resolve) => browser.once("exit", () => resolve()));
      if (process.platform === "win32" && browser.pid) spawnSync("taskkill", ["/pid", String(browser.pid), "/T", "/F"], { stdio: "ignore" });
      else browser.kill();
      await exited;
    }
    // A handle can outlive its process briefly on Windows; rmSync retries on EBUSY and EPERM.
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
}
