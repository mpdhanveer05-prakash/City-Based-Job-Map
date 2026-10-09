// A Playwright reporter for long local runs (scripts/e2e-full-run.mts): one JSON line per event, appended to the file in
// PROGRESS_FILE as it happens, so a run that is interrupted (or a session that ends) still leaves every result it reached.
// It changes nothing about how the tests run. Lines:
//   {"event":"begin", "total", "tests":[{id, project, file, title}], ...}
//   {"event":"start", id, retry, at}                          a test began (so a test that never ended is visible)
//   {"event":"end", id, project, file, title, status, expectedStatus, outcome, retry, durationMs, error?, at}
//   {"event":"done", status, durationMs, at}                  Playwright's own verdict for the run
import { appendFileSync } from "node:fs";
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from "@playwright/test/reporter";

const FILE = process.env.PROGRESS_FILE;

function write(line: Record<string, unknown>) {
  if (FILE) appendFileSync(FILE, JSON.stringify({ ...line, at: new Date().toISOString() }) + "\n");
}

const describe = (test: TestCase) => ({
  id: test.id,
  project: test.parent.project()?.name ?? "",
  file: test.location.file.replace(/\\/g, "/").replace(/^.*?\/tests\//, "tests/"),
  title: test.titlePath().slice(3).join(" › ") || test.title,
});

export default class ProgressReporter implements Reporter {
  onBegin(config: FullConfig, suite: Suite) {
    const tests = suite.allTests().map(describe);
    write({ event: "begin", total: tests.length, workers: config.workers, tests });
  }

  onTestBegin(test: TestCase, result: TestResult) {
    write({ event: "start", id: test.id, retry: result.retry });
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const error = result.error?.message ?? result.errors[0]?.message;
    write({
      event: "end",
      ...describe(test),
      status: result.status,
      expectedStatus: test.expectedStatus,
      outcome: test.outcome(),
      retry: result.retry,
      durationMs: result.duration,
      // Without the terminal colour codes of Playwright's messages.
      ...(error ? { error: error.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 2000) } : {}),
    });
  }

  onEnd(result: FullResult) {
    write({ event: "done", status: result.status, durationMs: result.duration });
  }

  printsToStdio() {
    return false;
  }
}
