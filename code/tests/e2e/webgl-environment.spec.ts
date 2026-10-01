import { expect, test } from "@playwright/test";

// The map specs need WebGL2 in the test browser. A CI runner has no GPU, so this reports what the browser really
// offers, in one second, before the slow map specs run. The line is also written as a workflow notice, so it shows
// up in the CI annotations even when the job fails.

test("the test browser can create a WebGL2 context", async ({ page, browserName }) => {
  await page.goto("/");
  const info = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) return { webgl2: false as const };
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      webgl2: true as const,
      renderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "unknown",
      maxTextureUnits: Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)),
      maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
    };
  });
  const line = `${browserName} ${page.context().browser()?.version() ?? ""} WebGL2: ${JSON.stringify(info)}`;
  console.log(`::notice title=WebGL environment::${line}`);
  expect(info.webgl2, `WebGL2 is not available in this browser (${line})`).toBe(true);
  if (info.webgl2) {
    // The marker shader samples the glyph sheet plus up to 8 logo pages.
    expect(info.maxTextureUnits).toBeGreaterThanOrEqual(9);
    expect(info.maxTextureSize).toBeGreaterThanOrEqual(2048);
  }
});
