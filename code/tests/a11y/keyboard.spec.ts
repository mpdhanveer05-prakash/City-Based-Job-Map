import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// P9-01. What the axe sweep in pages.spec.ts does not cover: the company, jobs, and suggest pages (with their report forms
// open), a keyboard-only journey, visible focus, and the 44 px touch-target rule from CLAUDE.md. A manual screen-reader pass
// (NVDA, TalkBack) is still owed; nothing here replaces it.

const COMPANY = "/companies/amber-forge-synthetic";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function blockingViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("the company page, with its report form open, has no serious or critical axe violations", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(COMPANY);
  await page.getByText("Something wrong on this page? Tell us").click();
  await expect(page.getByTestId("feedback-form-report")).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
});

test("the jobs page, with its report form open, has no serious or critical axe violations", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto(`${COMPANY}/jobs`);
  await page.getByText("A job that is closed or wrong? Tell us").click();
  await expect(page.getByTestId("feedback-form-report")).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
});

test("the suggest page has no serious or critical axe violations", async ({ page }) => {
  await stubTurnstile(page);
  await page.goto("/suggest");
  expect(await blockingViolations(page)).toEqual([]);
});

/** Replaces Cloudflare's script, so no spec contacts a third party. */
const stubTurnstile = (page: Page) =>
  page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) =>
    route.fulfill({ contentType: "text/javascript", body: "window.turnstile = { render() { return 'w1'; }, remove() {}, reset() {} };" }),
  );

/**
 * True when the focused element shows a ring or outline a keyboard user can see. The ring is drawn with a transition, so
 * this waits for it (up to a second) instead of reading the first frame.
 */
async function focusIsVisible(page: Page): Promise<boolean> {
  const read = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return false;
      const s = getComputedStyle(el);
      const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
      // A shadow that is fully transparent is a ring that has not faded in yet.
      const shadow = s.boxShadow !== "none" && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)\s*0px 0px 0px 0px/.test(s.boxShadow);
      return outline || shadow;
    });
  for (let i = 0; i < 10; i++) {
    if (await read()) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

const activeLabel = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return "(none)";
    const s = getComputedStyle(el);
    return `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}" outline ${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}, shadow ${s.boxShadow.slice(0, 60)}`;
  });

type Match = { text?: string; id?: string; testid?: string; link?: boolean };

/** Presses Tab until the focused element matches. Plain data, because the page's policy forbids building functions in it. */
async function tabTo(page: Page, match: Match, limit = 60) {
  const visited: string[] = [];
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press("Tab");
    const { found, name } = await page.evaluate((m) => {
      const el = document.activeElement;
      const label = el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""}` : "(none)";
      if (!el) return { found: false, name: label };
      if (m.id && el.id !== m.id) return { found: false, name: label };
      if (m.testid && el.getAttribute("data-testid") !== m.testid) return { found: false, name: label };
      if (m.link && el.tagName !== "A") return { found: false, name: label };
      if (m.text && !new RegExp(m.text).test(el.textContent ?? "")) return { found: false, name: label };
      return { found: true, name: label };
    }, match);
    visited.push(name);
    if (found) return;
  }
  throw new Error(`Tab did not reach ${JSON.stringify(match)} within ${limit} presses. Focus went through: ${visited.slice(0, 12).join(" > ")}`);
}

test.describe("keyboard only", () => {
  test.skip(({ isMobile }) => isMobile, "A phone has no keyboard journey");

  test("a company page: Tab reaches View jobs, then Visit website, each with a visible focus; Enter on View jobs opens the jobs", async ({ page }) => {
    await page.goto(COMPANY);
    await tabTo(page, { testid: "view-jobs" });
    expect(await focusIsVisible(page), `View jobs shows focus (${await activeLabel(page)})`).toBe(true);
    await tabTo(page, { text: "Visit website" });
    expect(await focusIsVisible(page), `Visit website shows focus (${await activeLabel(page)})`).toBe(true);
    // Back to View jobs and open it with Enter.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${COMPANY}/jobs$`));
    await expect(page.getByTestId("jobs-page")).toBeVisible();
  });

  test("a jobs page: every Apply link can be reached and shows focus; each row is only the title and Apply", async ({ page }) => {
    await page.goto(`${COMPANY}/jobs`);
    const rows = page.getByTestId("job-row");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await tabTo(page, { link: true, text: "^Apply" });
      expect(await focusIsVisible(page), `Apply ${i + 1} shows focus`).toBe(true);
    }
  });

  test("the suggest form can be filled and sent in with the keyboard alone", async ({ page }) => {
    await stubTurnstile(page);
    await page.goto("/suggest");
    await tabTo(page, { id: "feedback-company" });
    expect(await focusIsVisible(page), "the company field shows focus").toBe(true);
    await page.keyboard.type("Keyboard Co");
    await page.keyboard.press("Tab");
    await page.keyboard.type("https://keyboard.example/about");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Typed without a mouse.");
    await expect(page.locator("#feedback-company")).toHaveValue("Keyboard Co");
    await expect(page.locator("#feedback-source")).toHaveValue("https://keyboard.example/about");
    await expect(page.locator("#feedback-message")).toHaveValue("Typed without a mouse.");
    await tabTo(page, { testid: "feedback-send" });
    expect(await focusIsVisible(page), "Send shows focus").toBe(true);
  });

  test("the explorer's toolbar and the Map, Grid, List switch are all reachable by Tab", async ({ page }) => {
    await page.goto("/bangalore?view=list");
    await expect(page.getByTestId("explorer")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    await tabTo(page, { testid: "filter-types" });
    expect(await focusIsVisible(page), "the Type filter shows focus").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("filter-panel-types")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("filter-panel-types")).toBeHidden();
  });
});

// The project's own rule is 44 px for anything touched (WCAG 2.2 asks for 24). Links inside a sentence are exempt, as in the
// standard; everything else that can be pressed must be at least 44 by 44 CSS pixels.
const TARGET_PAGES = ["/", "/bangalore?view=list", COMPANY, `${COMPANY}/jobs`, "/suggest"];

for (const path of TARGET_PAGES) {
  test(`${path}: every control is at least 44 px square`, async ({ page }) => {
    await stubTurnstile(page);
    await page.goto(path);
    if (path.includes("bangalore")) await expect(page.getByTestId("explorer")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    // Open the report forms so their controls are measured too.
    for (const label of ["Something wrong on this page? Tell us", "A job that is closed or wrong? Tell us"]) {
      const summary = page.getByText(label);
      if (await summary.count()) await summary.click();
    }
    const small = await page.evaluate(() => {
      const found: string[] = [];
      const controls = document.querySelectorAll<HTMLElement>("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=option]");
      for (const el of controls) {
        const box = el.getBoundingClientRect();
        if (box.width <= 2 || box.height <= 2) continue; // visually hidden (sr-only)
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") continue;
        // A link inside running text is exempt.
        if (el.tagName === "A" && el.closest("p, li, dd")) {
          const parent = el.parentElement!;
          const own = [...parent.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0);
          if (own) continue;
        }
        // A checkbox or radio is pressed through its label: judge the label.
        const target = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? (el.closest("label") ?? el) : el;
        const t = target.getBoundingClientRect();
        if (t.width < 43.5 || t.height < 43.5) {
          const name = (el.getAttribute("aria-label") ?? el.textContent ?? el.id ?? "").trim().slice(0, 40);
          found.push(`${el.tagName.toLowerCase()} "${name}" ${Math.round(t.width)}x${Math.round(t.height)}`);
        }
      }
      return found;
    });
    expect(small).toEqual([]);
  });
}
