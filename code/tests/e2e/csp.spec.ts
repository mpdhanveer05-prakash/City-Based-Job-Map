import { expect, test, type Page } from "@playwright/test";

// P9-02. The policy is written into each page after the build (lib/csp.ts, scripts/inject-csp.mts). These specs load the
// real pages under it and fail on any violation, so a new script, image host, or connection that the policy does not allow
// is found here and not by a visitor.

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__cspViolations!.push(`${e.violatedDirective} ${e.blockedURI} (${e.sourceFile}:${e.lineNumber}, ${e.sample})`));
  });
}

const violations = (page: Page) => page.evaluate(() => window.__cspViolations ?? []);

const PAGES = ["/", "/bangalore", "/chennai", "/suggest", "/companies/amber-forge-synthetic", "/companies/amber-forge-synthetic/jobs"];

for (const path of PAGES) {
  test(`${path} loads under its Content-Security-Policy with no violation`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await watchViolations(page);
    await page.goto(path);
    await expect(page.locator("main, [data-testid='explorer']").first()).toBeVisible();
    // Let hydration and the first data requests finish.
    await page.waitForLoadState("networkidle");
    expect(await violations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("every page carries a policy with no unsafe-inline for scripts and no wildcard", async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(policy, path).toBeTruthy();
    const script = policy!.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src "))!;
    expect(script, path).not.toContain("'unsafe-inline'");
    expect(script, path).not.toContain("'unsafe-eval'");
    expect(policy, path).not.toMatch(/\s\*(\s|;|$)/);
    expect(policy, path).toContain("default-src 'none'");
    expect(policy, path).toContain("object-src 'none'");
  }
});

test("an inline script that the page did not ship is blocked", async ({ page }) => {
  await watchViolations(page);
  await page.goto("/suggest");
  await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = "window.__injected = true;";
    document.body.appendChild(s);
  });
  expect(await page.evaluate(() => (window as unknown as { __injected?: boolean }).__injected)).toBeUndefined();
  expect((await violations(page)).some((v) => v.startsWith("script-src"))).toBe(true);
});

test("a script from another site is blocked", async ({ page }) => {
  await watchViolations(page);
  await page.goto("/suggest");
  await page.route("https://evil.example/**", (route) => route.fulfill({ contentType: "text/javascript", body: "window.__injected = true;" }));
  await page.evaluate(() => {
    const s = document.createElement("script");
    s.src = "https://evil.example/x.js";
    document.body.appendChild(s);
  });
  await expect.poll(async () => (await violations(page)).some((v) => v.startsWith("script-src") && v.includes("evil.example"))).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __injected?: boolean }).__injected)).toBeUndefined();
});
