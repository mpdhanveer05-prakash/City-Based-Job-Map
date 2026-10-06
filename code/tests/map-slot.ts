// DEF-2: at most MAP_SLOTS map-heavy tests at once, across all Playwright workers. Each one draws WebGL in software
// (SwiftShader), so three at once slowed every map load two to four times (gate-results/map-load-times.jsonl, 7 Oct 2026:
// "ready" median 2.4 s and max 9.8 s with three workers, 1.1 s and 4.1 s with one) and, together with the rest of the
// suite, pushed the slowest past their timeouts. The light specs still use every worker.
//
// A slot is a directory made with mkdir, which is atomic; it holds the owner's pid, and a slot whose owner has exited is
// taken over, so a killed run leaves nothing stuck.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = process.env.MAP_SLOT_DIR ?? path.join(tmpdir(), "company-map-map-slots");
const SLOTS = Math.max(1, Number(process.env.MAP_SLOTS ?? 1));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tryTake(slot: string): boolean {
  try {
    mkdirSync(slot);
  } catch {
    let owner = NaN;
    try {
      owner = Number(readFileSync(path.join(slot, "pid"), "utf8"));
    } catch {
      // Being created or removed right now: treat as taken.
      return false;
    }
    if (Number.isFinite(owner) && alive(owner)) return false;
    rmSync(slot, { recursive: true, force: true });
    return false;
  }
  writeFileSync(path.join(slot, "pid"), String(process.pid));
  return true;
}

/** Waits for a free slot and returns the function that frees it. */
export async function takeMapSlot(): Promise<() => void> {
  mkdirSync(ROOT, { recursive: true });
  for (;;) {
    for (let i = 0; i < SLOTS; i++) {
      const slot = path.join(ROOT, `slot-${i}`);
      if (tryTake(slot)) return () => rmSync(slot, { recursive: true, force: true });
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
