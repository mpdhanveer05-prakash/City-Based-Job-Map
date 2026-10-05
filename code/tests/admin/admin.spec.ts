// P7-01 to P7-04 against the real local Supabase: sign-in, roles, the forms, the CSV import, the review queue, Publish now,
// and the audit log. Row-level security, the triggers, and the functions are the real ones. Run with `npm run test:admin`.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FAKE_GITHUB_PORT, PASSWORD, USERS } from "./global-setup";

test.describe.configure({ mode: "serial" });

const SUPABASE = process.env.ADMIN_E2E_SUPABASE_URL!;
const github = (path: string) => `http://127.0.0.1:${FAKE_GITHUB_PORT}${path}`;

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

async function signIn(page: Page, email: string, password = PASSWORD) {
  // Any Content-Security-Policy violation on these pages is a bug in the policy (lib/csp.ts) or in the page.
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__cspViolations?.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto("/admin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByTestId("sign-in").click();
}

async function signInAs(page: Page, who: keyof typeof USERS) {
  await signIn(page, USERS[who]);
  await expect(page.getByTestId("admin-frame")).toBeVisible({ timeout: 30_000 });
}

// Next.js adds its own role="alert" (the route announcer), so the page's messages are the paragraphs.
const alertOf = (page: Page) => page.locator('p[role="alert"]');

const noSeriousViolations = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
};

test.describe("sign-in and roles", () => {
  test("a wrong password gets one plain message that does not say which accounts exist", async ({ page }) => {
    await signIn(page, USERS.editor, "not the password");
    await expect(alertOf(page)).toHaveText("The email or password is wrong.");
    await signIn(page, "nobody@admin.test", "whatever");
    await expect(alertOf(page)).toHaveText("The email or password is wrong.");
    await expect(page.getByTestId("admin-frame")).toHaveCount(0);
  });

  test("public sign-up is closed: nobody can make themselves an account", async ({ request }) => {
    const anon = process.env.ADMIN_E2E_ANON_KEY!;
    const res = await request.post(`${SUPABASE}/auth/v1/signup`, { headers: { apikey: anon, "Content-Type": "application/json" }, data: { email: "stranger@example.test", password: "Test-password-1!" } });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await res.json())).toMatch(/signups? not allowed|disabled/i);
  });

  test("a signed-in user who is not an administrator sees nothing but a way out", async ({ page }) => {
    await signIn(page, USERS.plain);
    await expect(page.getByTestId("admin-forbidden")).toContainText("is not on the list of administrators");
    await expect(page.getByTestId("admin-frame")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
  });

  test("an editor sees the editor's pages, and Publish now is off", async ({ page }) => {
    await signInAs(page, "editor");
    await expect(page.getByTestId("admin-who")).toHaveText(`${USERS.editor} (editor)`);
    const nav = page.getByRole("navigation", { name: "Admin" });
    for (const name of ["Dashboard", "Companies", "Offices", "Jobs", "Import", "Review"]) await expect(nav.getByRole("link", { name })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Audit log" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Sources" })).toHaveCount(0);
    await expect(page.getByTestId("publish-now")).toBeDisabled();
    await expect(page.getByTestId("admin-counts")).toContainText("Published companies");
    await noSeriousViolations(page);
    expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
  });

  test("signing out returns to the sign-in form, and a reload stays signed out", async ({ page }) => {
    await signInAs(page, "editor");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
  });

  test("a session survives a reload", async ({ page }) => {
    await signInAs(page, "editor");
    await page.reload();
    await expect(page.getByTestId("admin-frame")).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("an editor curates a company", () => {
  test("creates a draft company with its types, stage, and sector", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/companies/edit?new=1");
    await page.getByLabel("Name").fill("E2E Test Co");
    await page.getByLabel("Domain").fill("e2e-test-co.test");
    await page.getByRole("checkbox", { name: "Startup" }).check();
    await page.getByLabel("Startup stage").selectOption("seed");
    await page.getByRole("checkbox", { name: "Fintech" }).check();
    await page.getByLabel("Description").fill("A company the end-to-end test made.");
    await page.getByTestId("save-company").click();
    await expect(page).toHaveURL(/\/admin\/companies\/edit\?id=/);
    await expect(page.getByRole("heading", { name: "Edit E2E Test Co" })).toBeVisible();
    await expect(page.getByLabel("Status")).toHaveValue("draft");
    await expect(page.getByLabel("Slug")).toHaveValue("e2e-test-co");
    await noSeriousViolations(page);
  });

  test("shows it in the list, found by search and by status", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/companies");
    await page.getByTestId("company-search").fill("e2e-test");
    await page.getByRole("button", { name: "Search" }).click();
    const row = page.locator('[data-company="e2e-test-co"]');
    await expect(row).toBeVisible();
    await expect(row).toContainText("Startup");
    await expect(row).toContainText("Seed");
    await expect(row).toContainText("Draft");
    await page.goto("/admin/companies?status=published&q=e2e-test");
    await expect(page.getByTestId("company-rows")).toContainText("No companies match.");
  });

  test("changing the types so Startup is dropped clears the stage in the same save", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/companies?q=e2e-test");
    await page.getByRole("link", { name: "E2E Test Co" }).click();
    await page.getByRole("checkbox", { name: "Startup" }).uncheck();
    await expect(page.getByLabel("Startup stage")).toBeDisabled();
    await page.getByRole("checkbox", { name: "MNC" }).check();
    await page.getByTestId("save-company").click();
    await expect(page.getByRole("status")).toHaveText("Saved.");
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "MNC" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Startup" })).not.toBeChecked();
    await expect(page.getByLabel("Startup stage")).toHaveValue("");
  });

  test("says what is wrong next to the field and does not save", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/companies/edit?new=1");
    await page.getByLabel("Name").fill("Bad Co");
    await page.getByLabel("Domain").fill("not a domain");
    await page.getByLabel("Website").fill("http://bad.test");
    await page.getByTestId("save-company").click();
    await expect(page.getByTestId("field-error").filter({ hasText: "must look like example.com" })).toBeVisible();
    await expect(page.getByTestId("field-error").filter({ hasText: "must be https" })).toBeVisible();
    await expect(alertOf(page)).toContainText("Some fields need attention.");
    await expect(page).toHaveURL(/new=1/);
  });

  test("a domain that is taken is refused with the database's reason", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/companies/edit?new=1");
    await page.getByLabel("Name").fill("Copycat");
    await page.getByLabel("Domain").fill("e2e-test-co.test");
    await page.getByTestId("save-company").click();
    await expect(alertOf(page)).toContainText("Another record already uses that domain.");
  });

  test("an editor cannot choose Published", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/companies?q=e2e-test");
    await page.getByRole("link", { name: "E2E Test Co" }).click();
    await expect(page.getByTestId("company-form-status").locator("option[value=published]")).toBeDisabled();
    await expect(page.getByText("Publishing needs a reviewer or an admin.")).toBeVisible();
  });

  test("adds an office, which then waits in the review queue for its low accuracy", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/companies?q=e2e-test");
    await page.getByRole("link", { name: "E2E Test Co" }).click();
    await page.getByRole("link", { name: /0 offices/ }).click();
    await page.getByTestId("new-office").click();
    await expect(page.getByTestId("picked-company")).toContainText("E2E Test Co");
    await page.getByLabel("City", { exact: true }).selectOption({ label: "Bengaluru" });
    await page.getByLabel("Neighbourhood").selectOption({ label: "Koramangala" });
    await page.getByLabel("Address").fill("7 E2E Road, Koramangala");
    await page.getByLabel("Latitude").fill("12.9352");
    await page.getByLabel("Longitude").fill("77.6245");
    await page.getByTestId("save-office").click();
    await expect(page).toHaveURL(/\/admin\/offices\/edit\?id=/);

    await page.goto("/admin/review");
    const queued = page.locator('[data-testid="review-offices"] tr', { hasText: "7 E2E Road" });
    await expect(queued).toContainText("location below building accuracy");
  });

  test("an office outside the city cannot be published until a reviewer accepts it", async ({ page }) => {
    await signInAs(page, "reviewer");
    await page.goto("/admin/offices/edit?new=1");
    await page.getByTestId("company-picker").fill("e2e-test");
    await page.getByRole("button", { name: /E2E Test Co/ }).click();
    await page.getByLabel("City", { exact: true }).selectOption({ label: "Bengaluru" });
    await page.getByLabel("Address").fill("Out of town");
    await page.getByLabel("Latitude").fill("20.0");
    await page.getByLabel("Longitude").fill("70.0");
    await page.getByLabel("Location accuracy").selectOption("building");
    await page.getByLabel("Status").selectOption("published");
    await page.getByTestId("save-office").click();
    await expect(alertOf(page)).toContainText("outside the boundary");
    await expect(page.getByText("Tick the box above to accept it")).toBeVisible();
    await page.getByTestId("outside-reviewed").check();
    await page.getByTestId("save-office").click();
    await expect(page).toHaveURL(/\/admin\/offices\/edit\?id=/);
  });

  test("adds a job whose link must be the company's own or a known applicant-tracking site", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/companies?q=e2e-test");
    await page.getByRole("link", { name: "E2E Test Co" }).click();
    await page.getByRole("link", { name: /\d+ jobs/ }).click();
    await page.getByTestId("new-job").click();
    // The list also has a "Search the title" box: wait for the form, and match the label exactly.
    await expect(page.getByTestId("job-form")).toBeVisible();
    await page.getByLabel("Title", { exact: true }).fill("QA Engineer");
    await page.getByLabel("Apply link").fill("https://phish.test/apply");
    await page.getByRole("checkbox", { name: "Bengaluru" }).check();
    await page.getByLabel("Source").selectOption({ index: 1 });
    await page.getByTestId("save-job").click();
    await expect(page.getByTestId("field-error").filter({ hasText: "neither e2e-test-co.test" })).toBeVisible();

    await page.getByLabel("Apply link").fill("https://e2e-test-co.test/careers/qa");
    await page.getByTestId("save-job").click();
    await expect(page).toHaveURL(/\/admin\/jobs\/edit\?id=/);
    await expect(page.getByLabel("Status")).toHaveValue("draft");
    await expect(page.getByLabel("Status").locator("option[value=active]")).toBeDisabled();
  });
});

test.describe("import", () => {
  const CSV = [
    "Company Name,Website,Domain,City,Address,Latitude,Longitude,Type,Stage,Sector,Accuracy,Neighborhood",
    'Imported One,https://imported-one.test,imported-one.test,Bengaluru,"1 Import Road, Indiranagar",12.978,77.640,startup,Series A,fintech,building,indiranagar',
    "Imported One,,imported-one.test,Bengaluru,2 Import Road,12.97,77.64,startup,,,,",
    "Imported One,,imported-one.test,Bengaluru,2 import road,12.97,77.64,startup,,,,",
    "E2E Test Co,,e2e-test-co.test,Bengaluru,9 Attached Road,12.95,77.62,mnc,,,building,",
    ",,nameless.test,Bengaluru,3 Road,12.9,77.6,startup,,,,",
    "Atlantis Co,,atlantis.test,Atlantis,4 Road,1,2,startup,,,,",
    "Stage Co,,stage.test,Chennai,5 Road,13.0,80.2,mnc,Seed,,,",
  ].join("\n");

  test("previews what every row would do, then imports only the good ones as drafts", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/import");
    await page.getByTestId("csv-file").setInputFiles({ name: "companies.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });

    await expect(page.getByTestId("import-summary")).toContainText("7 rows: 1 new companies, 2 added offices, 1 already listed, 3 that cannot be imported", { timeout: 30_000 });
    const rows = page.getByTestId("import-rows").locator("tr");
    await expect(rows.nth(0)).toContainText("New company");
    await expect(rows.nth(1)).toContainText("Adds an office");
    await expect(rows.nth(2)).toContainText("Already listed, skipped");
    await expect(rows.nth(3)).toContainText("Adds an office");
    await expect(rows.nth(4)).toContainText("The company name is missing.");
    await expect(rows.nth(5)).toContainText("is not a city this site covers");
    await expect(rows.nth(6)).toContainText("needs the type startup");
    await noSeriousViolations(page);

    await page.getByTestId("import-commit").click();
    await expect(page.getByTestId("import-report")).toContainText("1 companies created, 2 offices added, 0 skipped, 0 rows failed.", { timeout: 30_000 });

    await page.goto("/admin/companies?q=imported-one");
    const row = page.locator('[data-company="imported-one"]');
    await expect(row).toContainText("Draft");
    await expect(row).toContainText("Series A");
    await expect(row).toContainText("2");
  });

  test("importing the same file again adds nothing: every row is recognised", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/import");
    await page.getByTestId("csv-file").setInputFiles({ name: "companies.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
    await expect(page.getByTestId("import-summary")).toContainText("0 new companies, 0 added offices, 4 already listed, 3 that cannot be imported", { timeout: 30_000 });
    await expect(page.getByTestId("import-commit")).toBeDisabled();
  });

  test("a file without the required columns says which are missing", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/import");
    await page.getByTestId("csv-file").setInputFiles({ name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("name,domain\nA,a.test") });
    await expect(alertOf(page)).toContainText("no column for: city, address, lat, lng");
    await page.getByTestId("csv-file").setInputFiles({ name: "open.csv", mimeType: "text/csv", buffer: Buffer.from('name,domain\n"never closed,a.test') });
    await expect(alertOf(page)).toContainText("never closed");
  });

  test("the template download has the columns the import reads", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/import");
    const href = await page.getByTestId("template-link").getAttribute("href");
    const text = decodeURIComponent(href!.split(",").slice(1).join(","));
    expect(text.split("\n")[0]).toBe("name,domain,website_url,careers_url,description,types,startup_stage,sectors,city,address,lat,lng,accuracy,neighbourhood,tech_park");
  });
});

test.describe("review queue", () => {
  test("shows offices that need a look, and an editor can mark one reviewed", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/review");
    await expect(page.getByTestId("review-office-count")).not.toHaveText("Loading…");
    const row = page.locator('[data-testid="review-offices"] tr', { hasText: "1 Import Road" });
    await expect(row).toContainText("not yet verified");
    await row.getByTestId("mark-reviewed").click();
    await expect(page.getByRole("status").filter({ hasText: "Marked as reviewed." })).toBeVisible();
    await expect(page.locator('[data-testid="review-offices"] tr', { hasText: "1 Import Road" })).toHaveCount(0);
    // Only a reviewer accepts a point outside the boundary: the button is not offered to an editor.
    await expect(page.getByTestId("accept-outside")).toHaveCount(0);
  });

  test("an editor may look at suspect jobs but only a reviewer decides", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/review");
    await expect(page.getByTestId("review-job-count")).toContainText("jobs");
    const keep = page.getByTestId("keep-job").first();
    if (await keep.count()) await expect(keep).toBeDisabled();
  });

  test("a reviewer expires a suspect job", async ({ page }) => {
    await signInAs(page, "reviewer");
    await page.goto("/admin/review");
    await expect(page.getByTestId("review-job-count")).not.toHaveText("Loading…");
    const before = Number(/(\d+)/.exec((await page.getByTestId("review-job-count").textContent()) ?? "")?.[1] ?? 0);
    expect(before, "the seed has suspect jobs").toBeGreaterThan(0);
    await page.getByTestId("expire-job").first().click();
    await expect(page.getByRole("status").filter({ hasText: "Expired." })).toBeVisible();
    await expect(page.getByTestId("review-job-count")).toHaveText(`${before - 1} jobs`);
  });
});

test.describe("publish", () => {
  test("a reviewer publishes a company, and Publish now starts one build", async ({ page, request }) => {
    await request.get(github("/__reset"));
    await signInAs(page, "reviewer");
    await page.goto("/admin/companies?q=e2e-test");
    await page.getByRole("link", { name: "E2E Test Co" }).click();
    await page.getByTestId("company-form-status").selectOption("published");
    await page.getByTestId("save-company").click();
    await expect(page.getByRole("status")).toHaveText("Saved.");

    await page.goto("/admin");
    await expect(page.getByTestId("publish-now")).toBeEnabled();
    // The local Edge runtime sometimes answers 503 {"message":"name resolution failed"} (Docker's internal DNS, seen on
    // Windows under memory pressure) before the function's own code runs, so nothing was published and a second click is
    // safe. Retry only that exact answer; anything else is a real failure and says what the function answered.
    let answer;
    let answerBody = "";
    for (let attempt = 1; attempt <= 4; attempt++) {
      const answered = page.waitForResponse((r) => r.url().includes("/functions/v1/request-rebuild") && r.request().method() === "POST");
      await page.getByTestId("publish-now").click();
      answer = await answered;
      answerBody = await answer.text().catch(() => "(no body)");
      if (!(answer.status() === 503 && answerBody.includes("name resolution failed"))) break;
      await expect(page.getByTestId("publish-now")).toBeEnabled();
    }
    expect(answer!.status(), `the request-rebuild answer was: ${answerBody}`).toBe(200);
    await expect(page.getByText("Published. The site is rebuilding")).toBeVisible({ timeout: 30_000 });

    const dispatches = (await (await request.get(github("/__requests"))).json()) as Array<{ url: string; authorization: string; body: string }>;
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].url).toBe("/repos/owner/repo/dispatches");
    expect(dispatches[0].authorization).toBe("Bearer test-dispatch-token");
    expect(JSON.parse(dispatches[0].body)).toEqual({ event_type: "rebuild" });
  });

  test("a second Publish now inside ten minutes saves, does not start another build, and says when to retry", async ({ page, request }) => {
    await signInAs(page, "reviewer");
    await page.goto("/admin");
    await page.getByTestId("publish-now").click();
    await expect(page.getByText(/A rebuild was already started in the last ten minutes/)).toBeVisible({ timeout: 30_000 });
    const dispatches = (await (await request.get(github("/__requests"))).json()) as unknown[];
    expect(dispatches).toHaveLength(1);
  });

  test("the function itself refuses an editor, whatever the page does", async ({ page, request }) => {
    await signInAs(page, "editor");
    const token = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.endsWith("-auth-token"))!;
      return (JSON.parse(localStorage.getItem(key)!) as { access_token: string }).access_token;
    });
    const res = await request.post(`${SUPABASE}/functions/v1/request-rebuild`, { headers: { Authorization: `Bearer ${token}`, Origin: "http://localhost:3100" } });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toMatch(/reviewer or an admin/);
    const none = await request.post(`${SUPABASE}/functions/v1/request-rebuild`, { headers: { Origin: "http://localhost:3100" } });
    expect(none.status()).toBe(401);
    const wrongOrigin = await request.post(`${SUPABASE}/functions/v1/request-rebuild`, { headers: { Authorization: `Bearer ${token}`, Origin: "https://evil.example" } });
    expect(wrongOrigin.status()).toBe(403);
    expect(((await (await request.get(github("/__requests"))).json()) as unknown[]).length).toBe(1);
  });

  test("Publish now moved the data version, so the next build writes new dataset files", async ({ request }) => {
    const res = await request.get(`${SUPABASE}/rest/v1/city?select=slug,data_version&order=slug`, { headers: { apikey: process.env.ADMIN_E2E_ANON_KEY! } });
    expect(res.status()).toBe(200);
    const cities = (await res.json()) as Array<{ slug: string; data_version: number }>;
    expect(cities.map((c) => c.slug)).toEqual(["bangalore", "chennai"]);
    // Two publishes (one rebuilt, one inside the debounce): both moved the version past its starting 1.
    for (const c of cities) expect(c.data_version).toBeGreaterThanOrEqual(3);
  });
});

const TURNSTILE_STUB = `window.turnstile = { render(el, o) { setTimeout(() => o.callback(window.__turnstileToken || "stub-token-123456"), 0); return "w1"; }, remove() {}, reset() {} };`;

async function stubTurnstile(page: Page, token?: string) {
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) => route.fulfill({ contentType: "text/javascript", body: TURNSTILE_STUB }));
  if (token) await page.addInitScript((t) => ((window as unknown as { __turnstileToken: string }).__turnstileToken = t), token);
}

const FUNCTION = `${SUPABASE}/functions/v1/submit-feedback`;
const GOOD = { kind: "suggestion", target_type: "other", company_name: "Rate Co", source_url: "https://rate.example", message: "m", turnstile_token: "stub-token-123456" };
const sendFeedback = (request: APIRequestContext, data: unknown, origin: string | null = "http://localhost:3100") =>
  request.post(FUNCTION, { headers: { "Content-Type": "text/plain", ...(origin ? { Origin: origin } : {}) }, data: typeof data === "string" ? data : JSON.stringify(data) });

test.describe("public reports and suggestions", () => {
  // The limit is five stored submissions an hour from one connection, and every test here shares one connection:
  // three go through the forms, two through the function, and the sixth is refused.
  test("a visitor suggests a company, and gets a receipt and nothing else", async ({ page }) => {
    await stubTurnstile(page);
    await page.goto("/suggest");
    await expect(page.getByRole("heading", { level: 1, name: "Suggest a company" })).toBeVisible();
    await page.getByLabel("Company name").fill("Suggested Co");
    await page.getByLabel("A page that shows the company exists").fill("https://suggested-co.example/about");
    await page.getByLabel("What should we know?").fill("They opened an office in Chennai.");
    // The send waits for the stand-in check to give its token.
    await page.waitForTimeout(500);
    await page.getByTestId("feedback-send").click();
    await expect(page.getByTestId("feedback-receipt")).toContainText("Thank you. We received it (reference");
    await expect(page.getByTestId("feedback-receipt")).toContainText("nothing is published without a check");
  });

  test("a visitor reports a problem with a company", async ({ page }) => {
    await stubTurnstile(page);
    await page.goto("/companies/amber-forge-synthetic");
    await page.getByText("Something wrong on this page? Tell us").click();
    await page.getByTestId("feedback-message").fill("The office address is wrong.");
    await page.waitForTimeout(500);
    await page.getByTestId("feedback-send").click();
    await expect(page.getByTestId("feedback-receipt")).toBeVisible();
  });

  test("a visitor reports a job that is closed, choosing which one", async ({ page }) => {
    await stubTurnstile(page);
    await page.goto("/companies/amber-forge-synthetic/jobs");
    await page.getByText("A job that is closed or wrong? Tell us").click();
    await expect(page.getByTestId("feedback-target").locator("option").first()).toBeAttached();
    await page.getByTestId("feedback-message").fill("The page says the job is closed.");
    await page.waitForTimeout(500);
    await page.getByTestId("feedback-send").click();
    await expect(page.getByTestId("feedback-receipt")).toBeVisible();
  });

  test("a failed human check stores nothing and says so", async ({ page }) => {
    await stubTurnstile(page, "bad-token-123456");
    await page.goto("/suggest");
    await page.getByLabel("Company name").fill("Bot Co");
    await page.getByLabel("A page that shows the company exists").fill("https://bot.example/about");
    await page.getByLabel("What should we know?").fill("spam");
    await page.waitForTimeout(500);
    await page.getByTestId("feedback-send").click();
    await expect(page.getByTestId("feedback-error")).toContainText("did not pass");
    await expect(page.getByTestId("feedback-receipt")).toHaveCount(0);
  });

  test("the function refuses a bad origin, an unknown field, a missing or insecure link, and a body that is not JSON, before storing anything", async ({ request }) => {
    expect((await sendFeedback(request, GOOD, "https://evil.example")).status()).toBe(403);
    expect((await sendFeedback(request, GOOD, null)).status()).toBe(403);
    expect((await sendFeedback(request, { ...GOOD, email: "me@example.test" })).status()).toBe(400);
    expect((await sendFeedback(request, { ...GOOD, source_url: undefined })).status()).toBe(400);
    expect((await sendFeedback(request, { ...GOOD, source_url: "http://insecure.example" })).status()).toBe(400);
    expect((await sendFeedback(request, "not json")).status()).toBe(400);
    expect((await sendFeedback(request, { ...GOOD, turnstile_token: "bad-token-123456" })).status()).toBe(403);
  });

  test("a sixth submission from one connection in an hour is refused", async ({ request }) => {
    expect((await sendFeedback(request, GOOD)).status()).toBe(201);
    expect((await sendFeedback(request, GOOD)).status()).toBe(201);
    const refused = await sendFeedback(request, GOOD);
    expect(refused.status()).toBe(429);
    expect((await refused.json()).error).toMatch(/Too many/);
  });

  test("a reviewer reads what was sent, as plain text, and resolves or rejects it; an editor cannot", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/review");
    await expect(page.getByTestId("review-submission-count")).toHaveText("5 waiting");
    await expect(page.getByTestId("resolve-submission").first()).toBeDisabled();
    await page.getByRole("button", { name: "Sign out" }).click();

    await signInAs(page, "reviewer");
    await page.goto("/admin/review");
    const queue = page.getByTestId("review-submissions");
    await expect(queue).toContainText("Suggestion: Suggested Co");
    await expect(queue).toContainText("They opened an office in Chennai.");
    await expect(queue).toContainText("Report about a company");
    await expect(queue).toContainText("Report about a job");
    await expect(queue.getByRole("link", { name: /suggested-co\.example/ })).toHaveAttribute("rel", "noopener noreferrer");
    const first = queue.locator("li").first();
    await first.getByRole("textbox").fill("Added by hand.");
    await first.getByTestId("resolve-submission").click();
    await expect(page.getByRole("status").filter({ hasText: "Resolved." })).toBeVisible();
    await expect(page.getByTestId("review-submission-count")).toHaveText("4 waiting");
    await queue.locator("li").first().getByTestId("reject-submission").click();
    await expect(page.getByTestId("review-submission-count")).toHaveText("3 waiting");
  });
});

test.describe("what the open API shows an anonymous caller", () => {
  const anon = () => ({ apikey: process.env.ADMIN_E2E_ANON_KEY!, Authorization: `Bearer ${process.env.ADMIN_E2E_ANON_KEY}` });

  test("published companies only; no draft, no admin table, no audit log, no counter, no queue", async ({ request }) => {
    const all = (await (await request.get(`${SUPABASE}/rest/v1/company?select=status`, { headers: anon() })).json()) as Array<{ status: string }>;
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all.map((c) => c.status))).toEqual(new Set(["published"]));

    const tables = ["admin_user", "audit_log", "submission", "feedback_rate", "link_click_daily", "heartbeat", "verification_check", "verification_check_default", "job_feed", "source", "site_state", "import_batch"];
    for (const table of tables) {
      const res = await request.get(`${SUPABASE}/rest/v1/${table}?select=*&limit=5`, { headers: anon() });
      // Either the table is not reachable at all, or it is reachable and empty to this caller. Never rows.
      if (res.ok()) expect(await res.json(), table).toEqual([]);
      else expect(res.status(), table).toBeGreaterThanOrEqual(400);
    }
  });

  test("no privileged function can be called without a role", async ({ request }) => {
    const calls: Array<[string, unknown]> = [
      ["publish_now", {}],
      ["record_click", { p_kind: "apply", p_target_id: "00000000-0000-4000-8000-000000000001" }],
      ["submit_feedback", { p_kind: "report", p_target_type: "other", p_target_id: null, p_message: "x", p_source_url: null, p_company_name: null, p_client_hash: "\\x00112233445566778899aabbccddeeff" }],
      ["import_commit", { p_filename: "x.csv", p_rows: [{}] }],
      ["sweep_stale_jobs", {}],
      ["missed_heartbeats", {}],
    ];
    for (const [name, args] of calls) {
      const res = await request.post(`${SUPABASE}/rest/v1/rpc/${name}`, { headers: { ...anon(), "Content-Type": "application/json" }, data: args });
      expect(res.status(), name).toBeGreaterThanOrEqual(400);
    }
  });

  test("anon cannot write anywhere", async ({ request }) => {
    const rows: Array<[string, object]> = [
      ["company", { slug: "x", name: "x", domain: "x.test", website_url: "https://x.test" }],
      ["job", {}],
      ["city", { slug: "x" }],
      ["submission", { kind: "report", target_type: "other", message: "x" }],
    ];
    for (const [table, row] of rows) {
      const res = await request.post(`${SUPABASE}/rest/v1/${table}`, { headers: { ...anon(), "Content-Type": "application/json" }, data: row });
      expect(res.status(), table).toBeGreaterThanOrEqual(400);
    }
  });
});

test.describe("audit log and sources", () => {
  test("a reviewer reads the audit log: who changed what, with before and after", async ({ page }) => {
    await signInAs(page, "reviewer");
    await page.goto("/admin/audit");
    await page.getByLabel("Table").selectOption("company");
    const rows = page.getByTestId("audit-rows").locator("tr");
    await expect(rows.first()).toBeVisible();
    await expect(page.getByTestId("audit-rows")).toContainText("editor");
    await expect(page.getByTestId("audit-rows")).toContainText("update company");
    await page.getByRole("button", { name: "Details" }).first().click();
    await expect(page.getByRole("button", { name: "Hide" })).toBeVisible();
    await noSeriousViolations(page);
  });

  test("the audit log has the import's inserts and Publish now", async ({ page }) => {
    await signInAs(page, "reviewer");
    await page.goto("/admin/audit");
    await page.getByLabel("Action").selectOption("publish_now");
    await expect(page.getByTestId("audit-rows")).toContainText("publish_now site_state");
    await page.getByLabel("Action").selectOption("insert");
    await page.getByLabel("Table").selectOption("company");
    await expect(page.getByTestId("audit-rows")).toContainText("insert company");
  });

  test("an editor is told the audit log is not theirs, and has no Sources page", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/audit");
    await expect(page.getByText("The audit log is for reviewers and admins.")).toBeVisible();
    await page.goto("/admin/sources");
    await expect(page.getByText("Sources are managed by admins.")).toBeVisible();
  });

  test("an admin adds a source, with the permission to use it", async ({ page }) => {
    await signInAs(page, "admin");
    await page.goto("/admin/sources");
    await page.getByTestId("add-source").click();
    await expect(page.getByTestId("field-error").first()).toBeVisible();
    await page.getByLabel("Name").fill("E2E feed");
    await page.getByLabel("Kind").selectOption("csv_import");
    await page.getByLabel("Permission to use it").fill("Made by the end-to-end test.");
    await page.getByTestId("add-source").click();
    await expect(page.getByRole("status").filter({ hasText: "Added." })).toBeVisible();
    await expect(page.getByTestId("source-rows")).toContainText("E2E feed");
  });
});

test.describe("deleting", () => {
  test("an editor deletes a draft company with its offices and jobs, and cannot delete a published one", async ({ page }) => {
    await signInAs(page, "editor");
    // The company published in the earlier step stays: an editor may not remove it.
    await page.goto("/admin/companies?q=e2e-test");
    await page.getByRole("link", { name: "E2E Test Co" }).click();
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("delete-company").click();
    await expect(alertOf(page)).toContainText("may not delete it");
    await expect(page).toHaveURL(/\/admin\/companies\/edit\?id=/);

    // The imported draft company can go, with both of its offices.
    await page.goto("/admin/companies?q=imported-one");
    await page.getByRole("link", { name: "Imported One" }).click();
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("delete-company").click();
    await expect(page).toHaveURL(/\/admin\/companies$/);
    await page.goto("/admin/companies?q=imported-one");
    await expect(page.getByTestId("company-rows")).toContainText("No companies match.");
  });
});
