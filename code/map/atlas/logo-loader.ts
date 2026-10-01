// Fetches one company logo and turns it into the cell-sized, premultiplied RGBA bytes the atlas uploads.
// Only the pure helpers are unit-tested in Node; loadLogoPixels needs a browser (createImageBitmap, canvas).

/** Raster formats only: an SVG can carry script and cannot be decoded with createImageBitmap everywhere. */
const ALLOWED_TYPES = /^image\/(png|jpeg|webp|gif|avif)\b/i;
export const MAX_LOGO_BYTES = 1024 * 1024;
export const LOGO_TIMEOUT_MS = 10_000;

export class LogoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LogoError";
  }
}

/**
 * Logos come from our own storage. Accept https, same-origin paths, and blob: (used by the dev pages), and
 * nothing else: no http, no data:, no javascript:. When `allowedHosts` is given, an https logo must come from
 * one of those hosts (or a subdomain), so a bad row in the data cannot make a visitor's browser call a third
 * party. The explorer passes the storage host once the dataset exists (P4-01). Returns the URL to fetch.
 */
export function validateLogoUrl(url: string, base: string = "https://invalid.example", allowedHosts?: readonly string[]): string {
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    throw new LogoError("The logo URL is not a valid URL.");
  }
  const sameOriginPath = url.startsWith("/") && !url.startsWith("//");
  // Judge what was written, not what it resolves to: a bare "logo.png" would otherwise resolve to https.
  const written = /^(https:\/\/|blob:)/i.test(url) || sameOriginPath;
  if (!written || !(parsed.protocol === "https:" || parsed.protocol === "blob:")) {
    throw new LogoError(`A logo URL must be https:// or a /path on this site, not ${url.slice(0, 20)}`);
  }
  if (allowedHosts && parsed.protocol === "https:" && !sameOriginPath) {
    const host = parsed.hostname.toLowerCase();
    if (!allowedHosts.some((h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`))) {
      throw new LogoError(`Logos may not be loaded from ${host}.`);
    }
  }
  return parsed.protocol === "blob:" || /^https:/i.test(url) ? url : parsed.href;
}

/** Scales a w × h image to fit a cell, keeping its aspect ratio, centred. */
export function containRect(width: number, height: number, cell: number): { x: number; y: number; w: number; h: number } {
  if (width <= 0 || height <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const scale = Math.min(cell / width, cell / height);
  const w = width * scale;
  const h = height * scale;
  return { x: (cell - w) / 2, y: (cell - h) / 2, w, h };
}

/** Straight-alpha RGBA to premultiplied, in place. Premultiplied storage keeps transparent edges from fringing. */
export function premultiply(rgba: Uint8ClampedArray | Uint8Array): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a === 255) continue;
    rgba[i] = Math.round((rgba[i] * a) / 255);
    rgba[i + 1] = Math.round((rgba[i + 1] * a) / 255);
    rgba[i + 2] = Math.round((rgba[i + 2] * a) / 255);
  }
}

export type LoadLogoOptions = {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  allowedHosts?: readonly string[];
};

/** Cell-sized premultiplied RGBA bytes for the logo at `url`. Rejects with a LogoError on any problem. */
export async function loadLogoPixels(url: string, cellPx: number, options: LoadLogoOptions = {}): Promise<Uint8Array> {
  const target = validateLogoUrl(url, typeof location === "undefined" ? undefined : location.href, options.allowedHosts);
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), options.timeoutMs ?? LOGO_TIMEOUT_MS);
  const onAbort = () => timeout.abort();
  options.signal?.addEventListener("abort", onAbort);
  try {
    const response = await (options.fetchImpl ?? fetch)(target, {
      signal: timeout.signal,
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new LogoError(`The logo request failed with HTTP ${response.status}.`);
    const blob = await response.blob();
    if (blob.size > MAX_LOGO_BYTES) throw new LogoError("The logo file is too large.");
    if (!ALLOWED_TYPES.test(blob.type)) throw new LogoError(`The logo is not a supported raster image (${blob.type || "no type"}).`);

    const bitmap = await createImageBitmap(blob).catch(() => {
      throw new LogoError("The logo could not be decoded.");
    });
    try {
      const canvas = new OffscreenCanvas(cellPx, cellPx);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new LogoError("A 2D canvas is not available.");
      ctx.imageSmoothingQuality = "high";
      const fit = containRect(bitmap.width, bitmap.height, cellPx);
      ctx.drawImage(bitmap, fit.x, fit.y, fit.w, fit.h);
      const { data } = ctx.getImageData(0, 0, cellPx, cellPx);
      premultiply(data);
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } finally {
      bitmap.close();
    }
  } catch (error) {
    if (error instanceof LogoError) throw error;
    throw new LogoError(timeout.signal.aborted ? "The logo request timed out or was cancelled." : "The logo request failed.");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
