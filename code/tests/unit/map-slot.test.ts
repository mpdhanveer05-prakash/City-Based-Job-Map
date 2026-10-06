// DEF-2: the cross-worker map slot (tests/map-slot.ts).
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "map-slot-test-"));
let takeMapSlot: () => Promise<() => void>;

beforeAll(async () => {
  process.env.MAP_SLOT_DIR = dir;
  process.env.MAP_SLOTS = "1";
  ({ takeMapSlot } = await import("@/tests/map-slot"));
});

describe("map slot", () => {
  it("lets one holder in at a time, and the next in once it is freed", async () => {
    const release = await takeMapSlot();
    let second = false;
    const waiting = takeMapSlot().then((r) => {
      second = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(second).toBe(false);
    release();
    const releaseSecond = await waiting;
    expect(second).toBe(true);
    releaseSecond();
  });

  it("takes over a slot whose owner has exited", async () => {
    const slot = path.join(dir, "slot-0");
    mkdirSync(slot, { recursive: true });
    // A pid that is not running (the largest 32-bit value).
    writeFileSync(path.join(slot, "pid"), "2147483646");
    const release = await Promise.race([takeMapSlot(), new Promise<never>((_, no) => setTimeout(() => no(new Error("stuck")), 3_000))]);
    release();
  });
});
