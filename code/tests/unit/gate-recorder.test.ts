import { describe, expect, it } from "vitest";
import { DROPPED_FRAME_MS, STEP_WINDOW_MS, percentile, summariseFrames, type RawRecording } from "@/tests/gate/gate-recorder";

const recording = (frames: number[], updates: number[] = [], longTasks: number[] = []): RawRecording => ({
  frames,
  updates,
  longTasks,
  filterCalls: [],
  duplicateKeyFrames: 0,
  duplicateExamples: [],
  framesChecked: 0,
  startedAt: frames[0] ?? 0,
  endedAt: frames.at(-1) ?? 0,
  durationMs: (frames.at(-1) ?? 0) - (frames[0] ?? 0),
});

/** Frames at a fixed interval from `start`, `n` of them. */
const steady = (n: number, interval: number, start = 0) => Array.from({ length: n }, (_, i) => start + i * interval);

describe("percentile", () => {
  it("interpolates like the usual definition", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3); // the input need not be sorted
  });

  it("gives NaN for nothing", () => {
    expect(percentile([], 50)).toBeNaN();
  });
});

describe("summariseFrames", () => {
  it("reads a steady 60 Hz run as 60 fps with no dropped frames", () => {
    const s = summariseFrames(recording(steady(601, 1000 / 60)));
    expect(s.fps).toBe(60);
    expect(s.frameMs.p50).toBeCloseTo(16.67, 1);
    expect(s.frameMs.max).toBeCloseTo(16.67, 1);
    expect(s.droppedFrames).toBe(0);
    expect(s.droppedPercent).toBe(0);
  });

  it(`counts a frame later than ${DROPPED_FRAME_MS} ms after the one before as dropped`, () => {
    const frames = [...steady(50, 16.67), 50 * 16.67 + 40, ...steady(49, 16.67, 50 * 16.67 + 40 + 16.67)];
    const s = summariseFrames(recording(frames));
    expect(s.droppedFrames).toBe(1);
    // The late frame is 40 ms past where the 51st would have been: 16.67 + 40 after the one before it.
    expect(s.frameMs.max).toBeCloseTo(56.67, 1);
  });

  it("does not count 25 ms exactly, but counts 25.1", () => {
    expect(summariseFrames(recording([0, 25, 50])).droppedFrames).toBe(0);
    expect(summariseFrames(recording([0, 25.1, 50.2])).droppedFrames).toBe(2);
  });

  it("measures a step as the frames in the 300 ms after an update", () => {
    // Smooth for 1 s, an update at 1000 ms followed by a 50 ms hitch, then smooth again.
    const before = steady(60, 16.67); // 0 to ~983
    const hitchy = [1000, 1016.67, 1033.34, 1083.34, 1100, 1116.67, 1133.34, 1150, 1166.67, 1183.34, 1200, 1216.67, 1233.34, 1250, 1266.67, 1283.34, 1300];
    const s = summariseFrames(recording([...before, ...hitchy], [1000]));
    expect(s.steps.count).toBe(1);
    expect(s.steps.worstP95Ms).toBeGreaterThan(18); // the hitch is inside the step
    expect(s.steps.worstDroppedPercent).toBeGreaterThan(0);
    expect(s.steps.passing).toBe(0);
  });

  it("counts a smooth step as passing", () => {
    const frames = steady(120, 16.67);
    const s = summariseFrames(recording(frames, [500, 900]));
    expect(s.steps.count).toBe(2);
    expect(s.steps.passing).toBe(2);
    expect(s.steps.worstDroppedPercent).toBe(0);
  });

  it("ignores an update with too few frames after it to judge", () => {
    expect(summariseFrames(recording(steady(30, 16.67), [30 * 16.67 - 5])).steps.count).toBe(0);
  });

  it(`uses a ${STEP_WINDOW_MS} ms window`, () => {
    // A hitch 400 ms after the update is outside the step.
    const frames = [...steady(40, 16.67), 40 * 16.67 + 60, ...steady(20, 16.67, 40 * 16.67 + 60 + 16.67)];
    const s = summariseFrames(recording(frames, [0]));
    expect(s.steps.worstDroppedPercent).toBe(0);
    expect(s.droppedFrames).toBe(1);
  });

  it("reports long tasks", () => {
    const s = summariseFrames(recording(steady(10, 16.67), [], [62, 120]));
    expect(s.longTasks).toEqual({ count: 2, maxMs: 120 });
  });
});
