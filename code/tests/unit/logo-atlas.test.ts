import { describe, expect, it, vi } from "vitest";
import { DESKTOP_BUDGET_BYTES, MOBILE_BUDGET_BYTES, PAGE_SIZE, defaultBudgetBytes, maxPagesFor, pageBytes, slotsPerPage } from "@/map/atlas/budget";
import { LogoAtlas, MAX_LOGO_PAGES, type LogoAtlasOptions } from "@/map/atlas/logo-atlas";
import { LogoError, containRect, premultiply, validateLogoUrl } from "@/map/atlas/logo-loader";
import { SlotAllocator, slotRect } from "@/map/atlas/slot-allocator";
import { FramePacker, prepareScene, type LayerItem, FLOATS_PER_INSTANCE, STATIC_FLOATS } from "@/map/layer/instances";
import { viewFor } from "@/map/layer/geometry";
import { GLYPH_COUNT, type GlyphMetrics } from "@/map/atlas/glyphs";

describe("memory budget", () => {
  it("sizes a page as 2048 × 2048 RGBA8 = 16 MiB", () => {
    expect(pageBytes()).toBe(16 * 1024 * 1024);
    expect(pageBytes(256)).toBe(256 * 256 * 4);
  });

  it("allows 4 pages on a phone and 8 on a desktop, and never fewer than 1", () => {
    expect(maxPagesFor(MOBILE_BUDGET_BYTES)).toBe(4);
    expect(maxPagesFor(DESKTOP_BUDGET_BYTES)).toBe(8);
    expect(maxPagesFor(1)).toBe(1);
    expect(maxPagesFor(pageBytes() * 3 + 5)).toBe(3);
    expect(defaultBudgetBytes(true)).toBe(MOBILE_BUDGET_BYTES);
    expect(defaultBudgetBytes(false)).toBe(DESKTOP_BUDGET_BYTES);
  });

  it("holds 1,024 logos per page at 64 px and 256 at 128 px (map-spec §5)", () => {
    expect(slotsPerPage(64)).toBe(1024);
    expect(slotsPerPage(128)).toBe(256);
    expect(PAGE_SIZE).toBe(2048);
  });
});

describe("SlotAllocator", () => {
  const make = (slotsPerPage = 4, maxPages = 2) => new SlotAllocator<string>({ slotsPerPage, maxPages });

  it("fills a page row by row from the top left", () => {
    const a = make();
    expect(["a", "b", "c", "d"].map((k) => a.acquire(k, 1))).toEqual([0, 1, 2, 3].map((index) => ({ page: 0, index })));
    expect(a.pageCount).toBe(1);
  });

  it("adds a second page when the first is full, up to the cap", () => {
    const a = make();
    for (const k of ["a", "b", "c", "d"]) a.acquire(k, 1);
    expect(a.acquire("e", 1)).toEqual({ page: 1, index: 0 });
    expect(a.pageCount).toBe(2);
    for (const k of ["f", "g", "h"]) a.acquire(k, 1);
    expect(a.stats).toMatchObject({ pages: 2, used: 8, capacity: 8, evictions: 0 });
  });

  it("returns the same slot for the same key", () => {
    const a = make();
    expect(a.acquire("a", 1)).toBe(a.acquire("a", 2));
    expect(a.stats.used).toBe(1);
  });

  it("evicts the least recently used entry that was not used this frame", () => {
    const a = make(2, 1);
    const evicted: string[] = [];
    a.onEvict = (k) => evicted.push(k);
    a.acquire("a", 1);
    a.acquire("b", 1);
    // Frame 2: only "b" is on screen.
    a.touch("b", 2);
    const slot = a.acquire("c", 2);
    expect(evicted).toEqual(["a"]);
    expect(slot).toEqual({ page: 0, index: 0 }); // took a's cell
    expect(a.has("a")).toBe(false);
    expect(a.has("b")).toBe(true);
    expect(a.stats.evictions).toBe(1);
  });

  it("keeps recency order: touching an old entry saves it from the next eviction", () => {
    const a = make(3, 1);
    const evicted: string[] = [];
    a.onEvict = (k) => evicted.push(k);
    for (const k of ["a", "b", "c"]) a.acquire(k, 1);
    a.touch("a", 2); // a is now the newest; b is the oldest
    a.acquire("d", 3);
    a.acquire("e", 3);
    expect(evicted).toEqual(["b", "c"]);
  });

  it("never evicts an entry used in the current frame: no slot means the letter fallback", () => {
    const a = make(2, 1);
    a.acquire("a", 5);
    a.acquire("b", 5);
    expect(a.acquire("c", 5)).toBeNull();
    expect(a.stats.evictions).toBe(0);
    expect(a.has("a") && a.has("b")).toBe(true);
    // The next frame, both are old enough to go.
    expect(a.acquire("c", 6)).not.toBeNull();
  });

  it("reuses a released slot before adding a page or evicting", () => {
    const a = make(2, 2);
    a.acquire("a", 1);
    a.acquire("b", 1);
    a.release("a");
    expect(a.acquire("c", 1)).toEqual({ page: 0, index: 0 });
    expect(a.pageCount).toBe(1);
    expect(a.stats.evictions).toBe(0);
  });

  it("forgets everything on clear, as after a lost GL context", () => {
    const a = make();
    for (const k of ["a", "b", "c", "d", "e"]) a.acquire(k, 1);
    a.clear();
    expect(a.stats).toMatchObject({ pages: 0, used: 0 });
    expect(a.acquire("z", 1)).toEqual({ page: 0, index: 0 });
  });

  it("rejects an atlas with no room", () => {
    expect(() => make(0, 1)).toThrow();
    expect(() => make(1, 0)).toThrow();
  });

  it("maps a slot to pixels and texture coordinates", () => {
    expect(slotRect({ page: 0, index: 0 }, 64, 2048)).toEqual({ x: 0, y: 0, u: 0, v: 0 });
    expect(slotRect({ page: 3, index: 33 }, 64, 2048)).toEqual({ x: 64, y: 64, u: 64 / 2048, v: 64 / 2048 });
    expect(slotRect({ page: 0, index: 255 }, 128, 2048)).toEqual({ x: 15 * 128, y: 15 * 128, u: (15 * 128) / 2048, v: (15 * 128) / 2048 });
  });
});

describe("logo URLs and pixels", () => {
  it("accepts https, blob:, and same-origin paths, and nothing else", () => {
    expect(validateLogoUrl("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
    expect(validateLogoUrl("blob:http://localhost:3100/1234")).toBe("blob:http://localhost:3100/1234");
    expect(validateLogoUrl("/logos/a.png", "https://site.example/page")).toBe("https://site.example/logos/a.png");
    for (const bad of ["http://cdn.example.com/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "ftp://x/a.png", "not a url"]) {
      expect(() => validateLogoUrl(bad), bad).toThrow(LogoError);
    }
  });

  it("limits https logos to the allowed hosts and their subdomains", () => {
    const hosts = ["storage.example.com"];
    expect(validateLogoUrl("https://storage.example.com/a.png", undefined, hosts)).toContain("storage.example.com");
    expect(validateLogoUrl("https://eu.storage.example.com/a.png", undefined, hosts)).toContain("eu.storage");
    expect(() => validateLogoUrl("https://evil.example.org/a.png", undefined, hosts)).toThrow(/may not be loaded/);
    expect(() => validateLogoUrl("https://notstorage.example.com/a.png", undefined, hosts)).toThrow(LogoError);
    // A same-origin path and blob: are not subject to the list.
    expect(validateLogoUrl("/a.png", "https://site.example/", hosts)).toBe("https://site.example/a.png");
  });

  it("fits an image into a cell, keeping its aspect ratio, centred", () => {
    expect(containRect(100, 100, 64)).toEqual({ x: 0, y: 0, w: 64, h: 64 });
    expect(containRect(200, 100, 64)).toEqual({ x: 0, y: 16, w: 64, h: 32 });
    expect(containRect(50, 200, 64)).toEqual({ x: 24, y: 0, w: 16, h: 64 });
    expect(containRect(0, 10, 64)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it("premultiplies alpha in place", () => {
    const px = new Uint8Array([200, 100, 50, 255, 200, 100, 50, 128, 200, 100, 50, 0]);
    premultiply(px);
    expect(Array.from(px)).toEqual([200, 100, 50, 255, 100, 50, 25, 128, 0, 0, 0, 0]);
  });
});

// ---- The atlas, with controllable loads and a recording GL context.

type Load = { url: string; resolve: (px: Uint8Array) => void; reject: (e: Error) => void; signal: AbortSignal };

function harness(overrides: Partial<LogoAtlasOptions> = {}) {
  const loads: Load[] = [];
  let clock = 0;
  const changes = { n: 0 };
  const atlas = new LogoAtlas({
    cellPx: 64,
    pageSize: 128, // 2 × 2 cells = 4 slots per page
    budgetBytes: pageBytes(128) * 2, // two pages = 8 slots
    blendMs: 100,
    retryMs: 1000,
    now: () => clock,
    onChange: () => changes.n++,
    loadPixels: (url, _cell, signal) => new Promise<Uint8Array>((resolve, reject) => loads.push({ url, resolve, reject, signal })),
    ...overrides,
  });
  const uploads: Array<{ page: unknown; x: number; y: number; w: number }> = [];
  let bound: unknown = null;
  const gl = {
    TEXTURE_2D: 1, RGBA: 2, UNSIGNED_BYTE: 3, TEXTURE_MIN_FILTER: 4, TEXTURE_MAG_FILTER: 5, TEXTURE_WRAP_S: 6, TEXTURE_WRAP_T: 7,
    LINEAR: 8, NEAREST: 9, CLAMP_TO_EDGE: 10, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 11, UNPACK_FLIP_Y_WEBGL: 12, UNPACK_ALIGNMENT: 13, TEXTURE0: 100,
    createTexture: vi.fn(() => ({ id: Math.random() })),
    deleteTexture: vi.fn(),
    bindTexture: vi.fn((_t: number, tex: unknown) => { bound = tex; }),
    activeTexture: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    pixelStorei: vi.fn(),
    texSubImage2D: vi.fn((_t: number, _l: number, x: number, y: number, w: number) => uploads.push({ page: bound, x, y, w })),
    isContextLost: () => false,
  } as unknown as WebGL2RenderingContext;
  const tick = (ms: number) => { clock += ms; };
  const settle = () => new Promise<void>((r) => setTimeout(r, 0));
  const pixels = () => new Uint8Array(64 * 64 * 4);
  return { atlas, loads, gl, uploads, tick, settle, pixels, changes, now: () => clock };
}

/** Request a company's logo, finish its load, and put it on the GPU. */
async function loadOne(h: ReturnType<typeof harness>, id: number, url = `https://x/${id}.png`) {
  h.atlas.request(id, url);
  const load = h.loads.find((l) => l.url === url && !l.signal.aborted)!;
  load.resolve(h.pixels());
  await h.settle();
  h.atlas.flushUploads(h.gl);
}

describe("LogoAtlas", () => {
  it("starts no more loads than its concurrency, and queues the rest", () => {
    const h = harness({ concurrency: 3 });
    h.atlas.beginFrame();
    for (let id = 1; id <= 8; id++) h.atlas.request(id, `https://x/${id}.png`);
    expect(h.loads).toHaveLength(3);
    expect(h.atlas.stats).toMatchObject({ loading: 3, queued: 5 });
  });

  it("loads the most recently wanted logo first when a slot frees", async () => {
    const h = harness({ concurrency: 1 });
    h.atlas.beginFrame();
    h.atlas.request(1, "https://x/1.png"); // starts at once
    h.atlas.request(2, "https://x/2.png");
    h.atlas.beginFrame();
    h.atlas.request(3, "https://x/3.png"); // wanted in a later frame than 2
    h.loads[0].resolve(h.pixels());
    await h.settle();
    expect(h.loads.map((l) => l.url)).toEqual(["https://x/1.png", "https://x/3.png"]);
  });

  it("shows nothing until the logo is uploaded, then returns its cell", async () => {
    const h = harness();
    h.atlas.beginFrame();
    h.atlas.request(7, "https://x/7.png");
    expect(h.atlas.lookup(7)).toBeNull(); // loading: the letter shows
    h.loads[0].resolve(h.pixels());
    await h.settle();
    expect(h.atlas.lookup(7)).toBeNull(); // loaded but not yet on the GPU
    h.atlas.flushUploads(h.gl);
    expect(h.atlas.lookup(7)).toEqual({ page: 0, u: 0, v: 0, mix: 0 });
    expect(h.uploads).toEqual([{ page: expect.anything(), x: 0, y: 0, w: 64 }]);
    expect(h.gl.pixelStorei).toHaveBeenCalledWith((h.gl as unknown as { UNPACK_PREMULTIPLY_ALPHA_WEBGL: number }).UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  });

  it("cross-fades from the letter to the logo over blendMs", async () => {
    const h = harness({ blendMs: 100 });
    h.atlas.beginFrame();
    await loadOne(h, 1);
    const mixAt = (ms: number) => { h.tick(ms); h.atlas.beginFrame(); return h.atlas.lookup(1)!.mix; };
    expect(mixAt(0)).toBe(0);
    expect(mixAt(50)).toBeCloseTo(0.5, 6);
    expect(h.atlas.stats.blending).toBe(1);
    expect(h.atlas.needsRepaint).toBe(true);
    expect(mixAt(100)).toBe(1);
    expect(h.atlas.stats.blending).toBe(0);
    expect(h.atlas.needsRepaint).toBe(false);
  });

  it("swaps at once when motion is reduced (blendMs 0)", async () => {
    const h = harness({ blendMs: 0 });
    h.atlas.beginFrame();
    await loadOne(h, 1);
    expect(h.atlas.lookup(1)!.mix).toBe(1);
  });

  it("adds a second page when the first is full, and puts the logo on it", async () => {
    const h = harness();
    h.atlas.beginFrame();
    for (let id = 1; id <= 5; id++) await loadOne(h, id);
    expect(h.atlas.stats).toMatchObject({ pages: 2, ready: 5, slotsUsed: 5 });
    expect(h.atlas.lookup(5)).toMatchObject({ page: 1, u: 0, v: 0 });
    expect(h.atlas.lookup(4)).toMatchObject({ page: 0, u: 0.5, v: 0.5 });
  });

  it("stays inside the memory budget by evicting the least recently used logo", async () => {
    const h = harness(); // 2 pages × 4 slots = 8 logos, 128 KiB
    h.atlas.beginFrame();
    for (let id = 1; id <= 8; id++) await loadOne(h, id);
    expect(h.atlas.stats.bytes).toBe(pageBytes(128) * 2);

    // Next frame only logos 5…8 are on screen; a ninth logo arrives and takes the oldest cell.
    h.atlas.beginFrame();
    for (let id = 5; id <= 8; id++) h.atlas.lookup(id);
    await loadOne(h, 9);
    expect(h.atlas.stats).toMatchObject({ pages: 2, slotsUsed: 8, evictions: 1 });
    expect(h.atlas.stats.bytes).toBeLessThanOrEqual(h.atlas.budgetBytes);
    expect(h.atlas.lookup(1)).toBeNull(); // evicted: back to its letter
    expect(h.atlas.lookup(9)).not.toBeNull();
    for (let id = 5; id <= 8; id++) expect(h.atlas.lookup(id), `logo ${id} is on screen`).not.toBeNull();
  });

  it("keeps a loaded logo that is still waiting for its upload while its marker is on screen", async () => {
    const h = harness({ uploadsPerFrame: 1, concurrency: 20 });
    h.atlas.beginFrame();
    for (let id = 1; id <= 8; id++) {
      h.atlas.request(id, `https://x/${id}.png`);
      h.loads.at(-1)!.resolve(h.pixels());
    }
    await h.settle(); // all 8 loaded and holding a cell; none uploaded yet
    h.atlas.flushUploads(h.gl); // uploads one
    // The next frame every marker is still visible and asks again, but only a few are uploaded so far.
    h.atlas.beginFrame();
    for (let id = 1; id <= 8; id++) h.atlas.request(id, `https://x/${id}.png`);
    h.atlas.request(9, "https://x/9.png");
    h.loads.at(-1)!.resolve(h.pixels());
    await h.settle();
    expect(h.atlas.stats.evictions).toBe(0);
    expect(h.atlas.stats.slotsUsed).toBe(8);
    for (let id = 1; id <= 8; id++) h.atlas.request(id, `https://x/${id}.png`);
    while (h.atlas.needsRepaint) { h.atlas.flushUploads(h.gl); h.atlas.beginFrame(); for (let id = 1; id <= 8; id++) h.atlas.request(id, `https://x/${id}.png`); }
    for (let id = 1; id <= 8; id++) expect(h.atlas.lookup(id), `logo ${id}`).not.toBeNull();
  });

  it("asks again for an evicted logo when its marker is visible again", async () => {
    const h = harness();
    h.atlas.beginFrame();
    for (let id = 1; id <= 8; id++) await loadOne(h, id);
    h.atlas.beginFrame();
    await loadOne(h, 9); // evicts 1
    const before = h.loads.length;
    h.atlas.beginFrame();
    h.atlas.request(1, "https://x/1.png");
    expect(h.loads.length).toBe(before + 1);
  });

  it("falls back to the letter, and retries soon, when every cell is in use on screen", async () => {
    const h = harness();
    h.atlas.beginFrame();
    for (let id = 1; id <= 8; id++) await loadOne(h, id);
    // Same frame: all 8 logos are on screen, so a ninth cannot take a cell.
    for (let id = 1; id <= 8; id++) h.atlas.lookup(id);
    h.atlas.request(9, "https://x/9.png");
    h.loads.at(-1)!.resolve(h.pixels());
    await h.settle();
    expect(h.atlas.lookup(9)).toBeNull();
    expect(h.atlas.stats.evictions).toBe(0);
    expect(h.atlas.stats.failed).toBe(1);

    const count = h.loads.length;
    h.tick(500);
    h.atlas.request(9, "https://x/9.png");
    expect(h.loads.length).toBe(count); // too soon
    h.tick(600);
    h.atlas.beginFrame();
    h.atlas.request(9, "https://x/9.png");
    expect(h.loads.length).toBe(count + 1);

    // Still no room (all 8 are on screen in this frame too): the next look is 2 s away, then 4 s, up to 30 s,
    // so the overflow is not refetched constantly.
    for (let id = 1; id <= 8; id++) h.atlas.lookup(id);
    h.loads.at(-1)!.resolve(h.pixels());
    await h.settle();
    h.tick(1999);
    h.atlas.request(9, "https://x/9.png");
    expect(h.loads.length).toBe(count + 1);
    h.tick(2);
    h.atlas.request(9, "https://x/9.png");
    expect(h.loads.length).toBe(count + 2);
  });

  it("shows the letter for a failed load and retries with a doubling delay", async () => {
    const h = harness({ retryMs: 1000 });
    h.atlas.beginFrame();
    h.atlas.request(1, "https://x/1.png");
    h.loads[0].reject(new Error("404"));
    await h.settle();
    expect(h.atlas.lookup(1)).toBeNull();
    expect(h.atlas.stats.failed).toBe(1);

    h.tick(999);
    h.atlas.request(1, "https://x/1.png");
    expect(h.loads).toHaveLength(1); // not yet
    h.tick(2);
    h.atlas.request(1, "https://x/1.png");
    expect(h.loads).toHaveLength(2);
    h.loads[1].reject(new Error("404"));
    await h.settle();
    h.tick(1999);
    h.atlas.request(1, "https://x/1.png");
    expect(h.loads).toHaveLength(2); // second failure waits 2 s
    h.tick(2);
    h.atlas.request(1, "https://x/1.png");
    expect(h.loads).toHaveLength(3);
  });

  it("never blocks on a slow image: lookup answers at once, and the logo is used when it arrives", async () => {
    const h = harness();
    h.atlas.beginFrame();
    h.atlas.request(1, "https://x/slow.png");
    for (let frame = 0; frame < 30; frame++) {
      h.atlas.beginFrame();
      h.atlas.request(1, "https://x/slow.png");
      expect(h.atlas.lookup(1)).toBeNull();
    }
    expect(h.loads).toHaveLength(1); // asked once, not once per frame
    h.loads[0].resolve(h.pixels());
    await h.settle();
    h.atlas.flushUploads(h.gl);
    expect(h.atlas.lookup(1)).not.toBeNull();
  });

  it("drops a queued load that has not been wanted for 120 frames", async () => {
    const h = harness({ concurrency: 1 });
    h.atlas.beginFrame();
    h.atlas.request(1, "https://x/1.png");
    h.atlas.request(2, "https://x/2.png"); // queued behind 1
    for (let i = 0; i < 121; i++) h.atlas.beginFrame();
    h.loads[0].resolve(h.pixels());
    await h.settle();
    expect(h.loads).toHaveLength(1); // 2 scrolled away while it waited
    expect(h.atlas.stats.queued).toBe(0);
  });

  it("uploads at most uploadsPerFrame logos per frame and asks for more frames", async () => {
    const h = harness({ uploadsPerFrame: 2 });
    h.atlas.beginFrame();
    for (let id = 1; id <= 5; id++) {
      h.atlas.request(id, `https://x/${id}.png`);
      h.loads.at(-1)!.resolve(h.pixels());
    }
    await h.settle();
    h.atlas.flushUploads(h.gl);
    expect(h.uploads).toHaveLength(2);
    expect(h.atlas.needsRepaint).toBe(true);
    h.atlas.flushUploads(h.gl);
    h.atlas.flushUploads(h.gl);
    expect(h.uploads).toHaveLength(5);
    expect(h.atlas.stats.uploads).toBe(5);
  });

  it("does not upload a logo that was evicted while it waited", async () => {
    const h = harness({ uploadsPerFrame: 1 });
    h.atlas.beginFrame();
    for (let id = 1; id <= 8; id++) await loadOne(h, id);
    h.atlas.beginFrame();
    h.atlas.request(9, "https://x/9.png");
    h.loads.at(-1)!.resolve(h.pixels());
    await h.settle(); // 9 now holds logo 1's cell, upload pending
    expect(h.atlas.lookup(1)).toBeNull();
    const before = h.uploads.length;
    h.atlas.flushUploads(h.gl);
    expect(h.uploads.length).toBe(before + 1);
    expect(h.uploads.at(-1)).toMatchObject({ x: 0, y: 0 }); // 9 went into the evicted cell
  });

  it("reloads when a company's logo URL changes", async () => {
    const h = harness();
    h.atlas.beginFrame();
    await loadOne(h, 1, "https://x/old.png");
    h.atlas.request(1, "https://x/new.png");
    expect(h.atlas.lookup(1)).toBeNull();
    expect(h.loads.at(-1)!.url).toBe("https://x/new.png");
  });

  it("drops everything on a lost context and ignores loads that finish afterwards", async () => {
    const h = harness();
    h.atlas.beginFrame();
    await loadOne(h, 1);
    h.atlas.request(2, "https://x/2.png"); // in flight
    h.atlas.contextLost();
    expect(h.atlas.lookup(1)).toBeNull();
    expect(h.atlas.stats).toMatchObject({ pages: 0, ready: 0, slotsUsed: 0, loading: 0 });
    expect(h.loads[1].signal.aborted).toBe(true);
    h.loads[1].resolve(h.pixels());
    await h.settle();
    expect(h.atlas.stats).toMatchObject({ ready: 0, loading: 0 });
    // Visible markers ask again and it works.
    h.atlas.beginFrame();
    await loadOne(h, 1, "https://x/1.png");
    expect(h.atlas.lookup(1)).not.toBeNull();
  });

  it("binds a page per unit and a 1×1 texture for the rest, so every sampler is valid", async () => {
    const h = harness();
    h.atlas.beginFrame();
    await loadOne(h, 1);
    h.atlas.bindPages(h.gl, 1);
    const activeTexture = h.gl.activeTexture as unknown as ReturnType<typeof vi.fn>;
    expect(activeTexture.mock.calls.map((c) => c[0])).toEqual(Array.from({ length: MAX_LOGO_PAGES }, (_, i) => 100 + 1 + i));
  });

  it("limits itself to the budget even when the budget allows more pages than there are units", () => {
    const h = harness({ budgetBytes: pageBytes(128) * 40 });
    expect(h.atlas.stats.maxPages).toBe(MAX_LOGO_PAGES);
  });

  it("deletes its textures on dispose", async () => {
    const h = harness();
    h.atlas.beginFrame();
    await loadOne(h, 1);
    h.atlas.dispose(h.gl);
    expect(h.gl.deleteTexture).toHaveBeenCalled();
    expect(h.atlas.stats.pages).toBe(0);
  });
});

describe("logos in the frame packer", () => {
  const METRICS: GlyphMetrics = { advances: Array.from({ length: GLYPH_COUNT }, () => 0.5) };
  const PALETTE = { swatches: Array.from({ length: 5 }, () => [0, 0, 0] as [number, number, number]), logoFill: [1, 1, 1] as [number, number, number] };
  const view = viewFor({ lng: 77.5946, lat: 12.9716 }, 12, 1000, 800);
  const item = (key: string, extra: Partial<LayerItem>): LayerItem => ({ key, kind: "logo", lng: 77.5946, lat: 12.9716, ...extra });

  it("asks for a logo only for drawn items that have a company and a URL, never for clusters", () => {
    const far = viewFor({ lng: 77.5946, lat: 12.9716 }, 12, 1000, 800);
    const items: LayerItem[] = [
      item("with", { companyId: 7, logoUrl: "https://x/7.png" }),
      item("without", { companyId: 8 }),
      item("cluster", { kind: "cluster", count: 5, companyId: 9, logoUrl: "https://x/9.png" }),
      { ...item("culled", { companyId: 10, logoUrl: "https://x/10.png" }), lng: 100, lat: 40 },
    ];
    const scene = prepareScene(items, PALETTE, METRICS);
    const asked: number[] = [];
    new FramePacker().pack(scene, far, { logoFor: (i) => { asked.push(scene.companyIds[i]); return null; } });
    // "without" has no URL, so the scene holds no company for it; the cluster never gets a logo.
    expect(scene.logoUrls.filter(Boolean)).toEqual(["https://x/7.png", "https://x/10.png"]);
    expect(asked.filter((id) => id >= 0)).toEqual([7]);
  });

  it("writes the atlas cell into the instance, or -1 when there is none", () => {
    const scene = prepareScene([item("a", { companyId: 1, logoUrl: "https://x/1.png" }), item("b", { companyId: 2, logoUrl: "https://x/2.png" })], PALETTE, METRICS);
    const packer = new FramePacker();
    packer.pack(scene, view, { logoFor: (i) => (scene.companyIds[i] === 1 ? { page: 2, u: 0.25, v: 0.5, mix: 0.75 } : null) });
    const at = (n: number) => Array.from(packer.data.slice(n * FLOATS_PER_INSTANCE + 2 + STATIC_FLOATS, n * FLOATS_PER_INSTANCE + FLOATS_PER_INSTANCE));
    const results = [at(0), at(1)].sort((x, y) => y[0] - x[0]);
    expect(results[0]).toEqual([2, 0.25, 0.5, 0.75]);
    expect(results[1]).toEqual([-1, 0, 0, 0]);
  });
});
