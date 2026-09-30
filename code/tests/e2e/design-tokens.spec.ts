import { expect, test } from "@playwright/test";

const MILKY = "rgb(255, 253, 241)";
const MANTIS = "rgb(89, 199, 73)";
const INK = "rgb(31, 58, 26)";

test("home page renders on Milky with Ink text in Overpass", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Find companies by where they work.",
  );
  const body = page.locator("body");
  await expect(body).toHaveCSS("background-color", MILKY);
  await expect(body).toHaveCSS("color", INK);
  const fontFamily = await body.evaluate((el) => getComputedStyle(el).fontFamily);
  expect(fontFamily).toMatch(/Overpass/);
});

test("primary button is Mantis with Ink text and a 44 px target", async ({ page }) => {
  await page.goto("/dev/tokens");
  const button = page.getByRole("button", { name: "View company" });
  await expect(button).toHaveCSS("background-color", MANTIS);
  await expect(button).toHaveCSS("color", INK);
  const box = await button.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
});

test("keyboard focus shows a 2 px Ink outline", async ({ page, isMobile }) => {
  test.skip(isMobile, "Keyboard focus is checked on desktop");
  await page.goto("/dev/tokens");
  const button = page.getByRole("button", { name: "View company" });
  await button.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(button).toBeFocused();
  await expect(button).toHaveCSS("outline-style", "solid");
  await expect(button).toHaveCSS("outline-width", "2px");
  await expect(button).toHaveCSS("outline-color", INK);
});

test("contrast table reads the live tokens", async ({ page }) => {
  await page.goto("/dev/tokens");
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "ink on mantis", exact: true }) });
  await expect(row).toContainText("5.77:1");
});
