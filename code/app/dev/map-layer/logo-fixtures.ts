// Synthetic company logos for the /dev/map-layer page: small PNGs drawn in the page from the design tokens,
// served as blob: URLs, so the real fetch, decode, and upload path runs without any network or real logos.
// Every logo is synthetic and says so by being an abstract tile.

/** What the page can change at run time, and what tests read back. Not used by the app. */
export type LogoControl = {
  /** Added to every logo load, to look at a slow network. */
  delayMs: number;
  /** While true, no logo load finishes: tests use it to look at the page with every image still pending. */
  hold: boolean;
  /** Loads started (a retry counts again). */
  requested: number;
};

/** The logos whose images are missing: their blob URL has been revoked, so the fetch fails. */
export const isMissingLogo = (index: number): boolean => index % 7 === 0;

/** Every fifth logo is twice as wide as it is tall, so the contain-fit into a square cell is exercised. */
export const isWideLogo = (index: number): boolean => index % 5 === 1;

export async function makeLogoUrls(count: number, ink: string, milky: string): Promise<string[]> {
  const urls: string[] = [];
  for (let i = 0; i < count; i++) {
    const w = isWideLogo(i) ? 128 : 64;
    const canvas = new OffscreenCanvas(w, 64);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = ink;
    ctx.fillRect(0, 0, w, 64);
    ctx.fillStyle = milky;
    // A small centred tile whose size varies, so no two logos are the same picture. The tests sample the plain
    // Ink well to the left of it, away from any edge that scaling would blur.
    const size = 8 + (i % 5) * 2;
    ctx.fillRect((w - size) / 2, (64 - size) / 2, size, size);
    const url = URL.createObjectURL(await canvas.convertToBlob({ type: "image/png" }));
    if (isMissingLogo(i)) URL.revokeObjectURL(url);
    urls.push(url);
  }
  return urls;
}
