// The logo atlas (map-spec §5): company logos in multi-page GPU textures, with LRU eviction inside a memory
// budget. A logo that is loading, failed, or evicted simply has no entry here, and the layer draws the letter
// fallback for it, so a frame never waits on an image.
//
// Per company: request() (called for visible markers only) queues a load; at most `concurrency` loads run;
// a finished load takes a slot and waits for flushUploads() to copy it into its page, a few per frame;
// lookup() then returns where the logo is and how far its cross-fade from the fallback has got.
import { maxPagesFor, defaultBudgetBytes, PAGE_SIZE, pageBytes, slotsPerPage } from "./budget.ts";
import { loadLogoPixels } from "./logo-loader.ts";
import { SlotAllocator, slotRect, type Slot } from "./slot-allocator.ts";

/** Fragment shader texture units available to logo pages. The cap is the desktop budget (128 MB / 16 MB). */
export const MAX_LOGO_PAGES = 8;

export type LogoRef = {
  page: number;
  /** The cell's top-left corner in texture coordinates. */
  u: number;
  v: number;
  /** 0 = only the fallback, 1 = only the logo. */
  mix: number;
};

export type LogoAtlasOptions = {
  cellPx: 64 | 128;
  pageSize?: number;
  /** GPU memory for logo textures. Default 64 MB with a coarse pointer, 128 MB otherwise. */
  budgetBytes?: number;
  concurrency?: number;
  /** Cross-fade from the fallback to the logo. 0 under prefers-reduced-motion. */
  blendMs?: number;
  /** First retry delay after a failed load; doubles per failure up to five minutes. */
  retryMs?: number;
  /** Uploads per frame, so a burst of finished logos cannot stall a frame. */
  uploadsPerFrame?: number;
  allowedHosts?: readonly string[];
  now?: () => number;
  /** Replaceable for tests. */
  loadPixels?: (url: string, cellPx: number, signal: AbortSignal) => Promise<Uint8Array>;
  /** A logo became available or went away: repaint. */
  onChange?: () => void;
};

export type LogoAtlasStats = {
  pages: number;
  maxPages: number;
  /** Texture memory in use. Never above `budgetBytes`, except that one page is always allowed. */
  bytes: number;
  budgetBytes: number;
  slotsUsed: number;
  slotsCapacity: number;
  queued: number;
  loading: number;
  ready: number;
  failed: number;
  evictions: number;
  uploads: number;
  /** Logos still cross-fading in the last frame. */
  blending: number;
};

type Entry = {
  id: number;
  url: string;
  status: "queued" | "loading" | "ready" | "failed";
  /** The frame in which a marker last asked for this logo. */
  lastWanted: number;
  seq: number;
  slot?: Slot;
  pixels?: Uint8Array;
  uploaded: boolean;
  readyAt: number;
  failures: number;
  /** Times a finished load found every cell in use on screen. */
  noSpace: number;
  retryAt: number;
};

/** A queued load that has not been wanted for this many frames is dropped: the marker left the screen. */
const STALE_FRAMES = 120;
const MAX_RETRY_MS = 5 * 60_000;
const NO_SPACE_RETRY_MS = 1000;
const MAX_NO_SPACE_RETRY_MS = 30_000;

export const prefersReducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export class LogoAtlas {
  readonly cellPx: 64 | 128;
  readonly pageSize: number;
  readonly budgetBytes: number;

  private readonly maxPages: number;
  private readonly concurrency: number;
  private readonly blendMs: number;
  private readonly retryMs: number;
  private readonly uploadsPerFrame: number;
  private readonly allowedHosts?: readonly string[];
  private readonly now: () => number;
  private readonly loadPixels: NonNullable<LogoAtlasOptions["loadPixels"]>;
  private onChange: () => void;

  private readonly allocator: SlotAllocator<number>;
  private readonly entries = new Map<number, Entry>();
  private readonly queued = new Set<number>();
  private uploads: number[] = [];
  private pageTextures: WebGLTexture[] = [];
  private dummy: WebGLTexture | null = null;
  private frame = 0;
  private seq = 0;
  private loading = 0;
  private uploaded = 0;
  private blending = 0;
  /** Bumped when the GPU state is thrown away, so loads that finish later are ignored. */
  private epoch = 0;
  private controller = new AbortController();

  constructor(options: LogoAtlasOptions) {
    this.cellPx = options.cellPx;
    this.pageSize = options.pageSize ?? PAGE_SIZE;
    const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    this.budgetBytes = options.budgetBytes ?? defaultBudgetBytes(coarse);
    this.maxPages = Math.min(MAX_LOGO_PAGES, maxPagesFor(this.budgetBytes, this.pageSize));
    this.concurrency = options.concurrency ?? 6;
    this.blendMs = options.blendMs ?? (prefersReducedMotion() ? 0 : 150);
    this.retryMs = options.retryMs ?? 30_000;
    this.uploadsPerFrame = options.uploadsPerFrame ?? 4;
    this.allowedHosts = options.allowedHosts;
    this.now = options.now ?? (() => performance.now());
    this.onChange = options.onChange ?? (() => {});
    this.loadPixels =
      options.loadPixels ??
      ((url, cellPx, signal) => loadLogoPixels(url, cellPx, { signal, allowedHosts: this.allowedHosts }));

    this.allocator = new SlotAllocator<number>({ slotsPerPage: slotsPerPage(this.cellPx, this.pageSize), maxPages: this.maxPages });
    this.allocator.onEvict = (id) => {
      // The logo loses its cell; the marker goes back to its letter and asks again if it is still visible.
      this.entries.delete(id);
      this.onChange();
    };
  }

  get stats(): LogoAtlasStats {
    let ready = 0;
    let failed = 0;
    for (const e of this.entries.values()) {
      if (e.status === "ready") ready++;
      else if (e.status === "failed") failed++;
    }
    const a = this.allocator.stats;
    return {
      pages: this.pageTextures.length,
      maxPages: this.maxPages,
      bytes: this.pageTextures.length * pageBytes(this.pageSize),
      budgetBytes: this.budgetBytes,
      slotsUsed: a.used,
      slotsCapacity: a.capacity,
      queued: this.queued.size,
      loading: this.loading,
      ready,
      failed,
      evictions: a.evictions,
      uploads: this.uploaded,
      blending: this.blending,
    };
  }

  /** Starts a frame: markers that ask for logos now count as wanted in this frame. */
  beginFrame(): void {
    this.frame++;
    this.blending = 0;
  }

  /** True while uploads wait for a later frame or logos are still cross-fading: the layer should keep repainting. */
  get needsRepaint(): boolean {
    return this.uploads.length > 0 || this.blending > 0;
  }

  /** Where to report that a logo arrived or went away. The layer points this at the map's repaint. */
  setOnChange(listener: () => void): void {
    this.onChange = listener;
  }

  /** A visible marker wants this company's logo. Cheap to call every frame. */
  request(id: number, url: string): void {
    let e = this.entries.get(id);
    if (e && e.url !== url) {
      // The company's logo changed: forget the old one.
      this.allocator.release(id);
      this.queued.delete(id);
      this.entries.delete(id);
      e = undefined;
    }
    if (!e) {
      e = { id, url, status: "queued", lastWanted: this.frame, seq: this.seq++, uploaded: false, readyAt: 0, failures: 0, noSpace: 0, retryAt: 0 };
      this.entries.set(id, e);
      this.queued.add(id);
      this.pump();
      return;
    }
    e.lastWanted = this.frame;
    // A logo that has loaded but is still waiting for its upload is not looked up yet, so it is pinned here:
    // its marker is on screen, and another load must not take its cell.
    if (e.status === "ready") this.allocator.touch(id, this.frame);
    if (e.status === "failed" && this.now() >= e.retryAt) {
      e.status = "queued";
      this.queued.add(id);
      this.pump();
    }
  }

  /** Where the logo is, once it is on the GPU. Null while it is loading, failed, or evicted. */
  lookup(id: number): LogoRef | null {
    const e = this.entries.get(id);
    if (!e || e.status !== "ready" || !e.uploaded || !e.slot) return null;
    this.allocator.touch(id, this.frame);
    const { u, v } = slotRect(e.slot, this.cellPx, this.pageSize);
    const mix = this.blendMs <= 0 ? 1 : Math.min(1, Math.max(0, (this.now() - e.readyAt) / this.blendMs));
    if (mix < 1) this.blending++;
    return { page: e.slot.page, u, v, mix };
  }

  /** Copies finished logos into their pages, a few per frame. Needs the layer's GL context. */
  flushUploads(gl: WebGL2RenderingContext): void {
    while (this.pageTextures.length < this.allocator.pageCount) this.pageTextures.push(this.createPage(gl));
    let done = 0;
    while (this.uploads.length > 0 && done < this.uploadsPerFrame) {
      const id = this.uploads.shift()!;
      const e = this.entries.get(id);
      if (!e || !e.slot || !e.pixels || e.uploaded) continue; // evicted or replaced while waiting
      const { x, y } = slotRect(e.slot, this.cellPx, this.pageSize);
      gl.bindTexture(gl.TEXTURE_2D, this.pageTextures[e.slot.page]);
      // The bytes are already premultiplied, so no GL conversion may touch them.
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, this.cellPx, this.cellPx, gl.RGBA, gl.UNSIGNED_BYTE, e.pixels);
      e.pixels = undefined;
      e.uploaded = true;
      e.readyAt = this.now();
      this.uploaded++;
      done++;
    }
    if (done > 0) this.onChange();
  }

  /** Binds page textures to `firstUnit …`; units with no page get a 1×1 texture so every sampler is valid. */
  bindPages(gl: WebGL2RenderingContext, firstUnit: number): void {
    if (!this.dummy) {
      this.dummy = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.dummy);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    for (let i = 0; i < MAX_LOGO_PAGES; i++) {
      gl.activeTexture(gl.TEXTURE0 + firstUnit + i);
      gl.bindTexture(gl.TEXTURE_2D, this.pageTextures[i] ?? this.dummy);
    }
  }

  /** The GL context was lost: every texture is gone. Drop all state; visible markers will ask again. */
  contextLost(): void {
    this.epoch++;
    this.controller.abort();
    this.controller = new AbortController();
    this.entries.clear();
    this.queued.clear();
    this.uploads = [];
    this.allocator.clear();
    this.pageTextures = [];
    this.dummy = null;
    this.loading = 0;
  }

  dispose(gl?: WebGL2RenderingContext): void {
    if (gl && !gl.isContextLost()) {
      for (const t of this.pageTextures) gl.deleteTexture(t);
      if (this.dummy) gl.deleteTexture(this.dummy);
    }
    this.contextLost();
  }

  private createPage(gl: WebGL2RenderingContext): WebGLTexture {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.pageSize, this.pageSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  /** Starts queued loads, most recently wanted first, until `concurrency` are running. */
  private pump(): void {
    while (this.loading < this.concurrency && this.queued.size > 0) {
      let best: Entry | undefined;
      for (const id of this.queued) {
        const e = this.entries.get(id)!;
        if (!best || e.lastWanted > best.lastWanted || (e.lastWanted === best.lastWanted && e.seq < best.seq)) best = e;
      }
      this.queued.delete(best!.id);
      if (this.frame - best!.lastWanted > STALE_FRAMES) {
        this.entries.delete(best!.id); // scrolled out of view while waiting
        continue;
      }
      this.start(best!);
    }
  }

  private start(e: Entry): void {
    e.status = "loading";
    this.loading++;
    const epoch = this.epoch;
    this.loadPixels(e.url, this.cellPx, this.controller.signal).then(
      (pixels) => {
        if (epoch !== this.epoch) return;
        this.loading--;
        if (this.entries.get(e.id) !== e) return this.pump(); // replaced meanwhile
        const slot = this.allocator.acquire(e.id, this.frame);
        if (!slot) {
          // Every cell is in use by a logo on screen right now: more logos are visible than the budget holds.
          // Show the letter and look again later, backing off so the overflow is not refetched every second.
          e.noSpace++;
          e.status = "failed";
          e.retryAt = this.now() + Math.min(NO_SPACE_RETRY_MS * 2 ** (e.noSpace - 1), MAX_NO_SPACE_RETRY_MS);
        } else {
          e.slot = slot;
          e.pixels = pixels;
          e.status = "ready";
          this.uploads.push(e.id);
        }
        this.pump();
        this.onChange();
      },
      () => {
        if (epoch !== this.epoch) return;
        this.loading--;
        if (this.entries.get(e.id) === e) {
          e.failures++;
          e.status = "failed";
          e.retryAt = this.now() + Math.min(this.retryMs * 2 ** (e.failures - 1), MAX_RETRY_MS);
        }
        this.pump();
        this.onChange();
      },
    );
  }
}
