// P7-01 to P7-04 against the real local Supabase: sign-in, roles, the forms, the CSV import, the review queue, Publish now,
// and the audit log. Row-level security, the triggers, and the functions are the real ones. Run with `npm run test:admin`.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import pg from "pg";
import { readFileSync } from "node:fs";
import { FAKE_GITHUB_PORT, PASSWORD, TOTP_SECRETS_FILE, USERS } from "./global-setup";
import { totp } from "./totp";

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

/** The code an administrator's authenticator app would show now (global setup enrolled the factor). */
const codeFor = (email: string) => totp((JSON.parse(readFileSync(TOTP_SECRETS_FILE, "utf8")) as Record<string, string>)[email]);

async function signInAs(page: Page, who: "editor" | "reviewer" | "admin") {
  await signIn(page, USERS[who]);
  // The password alone is not enough (P9-13): the second factor's code comes next.
  await expect(page.getByTestId("mfa-verify")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("mfa-code").fill(codeFor(USERS[who]));
  await page.getByTestId("mfa-submit").click();
  await expect(page.getByTestId("admin-frame")).toBeVisible({ timeout: 30_000 });
}

// Records one piece of evidence through the company page's evidence panel (P9-07).
async function recordEvidence(page: Page, fact: string, source: string, date = "2026-09-01") {
  const panel = page.getByTestId("evidence-panel");
  await panel.getByTestId("evidence-target").selectOption({ label: fact });
  await panel.getByTestId("evidence-source").fill(source);
  await panel.getByTestId("evidence-date").fill(date);
  await panel.getByTestId("save-evidence").click();
  await expect(panel.getByRole("status").filter({ hasText: "Evidence recorded." })).toBeVisible();
}

// Next.js adds its own role="alert" (the route announcer), so the page's messages are the paragraphs.
const alertOf = (page: Page) => page.locator('p[role="alert"]');

const parseCsvLine = (line: string): string[] => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.slice(0, -1).map((c) => c.replace(/,$/, ""));

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

  test("a password alone is not enough: a wrong code is refused, and the database refuses the password-only session", async ({ page, request }) => {
    await signIn(page, USERS.editor);
    await expect(page.getByTestId("mfa-verify")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("admin-frame")).toHaveCount(0);
    const right = codeFor(USERS.editor);
    await page.getByTestId("mfa-code").fill(right === "000000" ? "111111" : "000000");
    await page.getByTestId("mfa-submit").click();
    await expect(alertOf(page)).toHaveText("That code is wrong or has expired. Enter the current code.");
    await expect(page.getByTestId("admin-frame")).toHaveCount(0);
    await noSeriousViolations(page);

    // The page is only the front door: with the same password-only (aal1) token, the database says no.
    const anon = process.env.ADMIN_E2E_ANON_KEY!;
    const token = (await (await request.post(`${SUPABASE}/auth/v1/token?grant_type=password`, { headers: { apikey: anon }, data: { email: USERS.editor, password: PASSWORD } })).json()).access_token as string;
    const rpc = await request.post(`${SUPABASE}/rest/v1/rpc/is_admin`, { headers: { apikey: anon, Authorization: `Bearer ${token}` }, data: {} });
    expect(await rpc.json()).toBe(false);
    const drafts = await request.get(`${SUPABASE}/rest/v1/company?select=id&status=eq.draft`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
    expect(await drafts.json()).toEqual([]);
  });

  test("an administrator without a second factor must set one up before seeing anything", async ({ page }) => {
    await signIn(page, USERS.newcomer);
    await expect(page.getByTestId("mfa-enrol")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("admin-frame")).toHaveCount(0);
    await expect(page.getByRole("img", { name: "QR code for your authenticator app" })).toBeVisible();
    const secret = (await page.getByTestId("mfa-secret").textContent())!.trim();
    await noSeriousViolations(page);
    await page.getByTestId("mfa-code").fill(totp(secret));
    await page.getByTestId("mfa-submit").click();
    await expect(page.getByTestId("admin-frame")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("admin-who")).toHaveText(`${USERS.newcomer} (editor)`);
  });

  // Past the page, on the real Auth service: a token outlives its session and its factor, so the database checks both.
  const isAdminWith = async (request: APIRequestContext, token: string) => {
    const anon = process.env.ADMIN_E2E_ANON_KEY!;
    const res = await request.post(`${SUPABASE}/rest/v1/rpc/is_admin`, { headers: { apikey: anon, Authorization: `Bearer ${token}` }, data: {} });
    return { status: res.status(), body: await res.text() };
  };
  const sessionToken = (page: Page) =>
    page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.startsWith("sb-") && x.endsWith("-auth-token"))!;
      return (JSON.parse(localStorage.getItem(k)!) as { access_token: string }).access_token;
    });

  test("after signing out, the same unexpired aal2 token is no longer an administrator's", async ({ page, request }) => {
    await signInAs(page, "editor");
    const token = await sessionToken(page);
    expect(JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).aal).toBe("aal2");
    expect((await isAdminWith(request, token)).body).toBe("true");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
    expect((await isAdminWith(request, token)).body, "the session is gone, so the token is refused").toBe("false");
  });

  test("an expired token is refused by the API before the database sees it", async ({ page, request }) => {
    await signInAs(page, "reviewer");
    const token = await sessionToken(page);
    const { createHmac } = await import("node:crypto");
    const sign = (claims: Record<string, unknown>) => {
      const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
      return `${head}.${body}.${createHmac("sha256", process.env.ADMIN_E2E_JWT_SECRET!).update(`${head}.${body}`).digest("base64url")}`;
    };
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as Record<string, unknown>;
    // The same claims re-signed with the local secret and a later expiry work, which proves the signing is right...
    expect((await isAdminWith(request, sign({ ...claims, exp: Math.floor(Date.now() / 1000) + 600 }))).body).toBe("true");
    // ...and expired a minute ago they are refused.
    const expired = await isAdminWith(request, sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 60 }));
    expect(expired.status).toBe(401);
    expect(expired.body).toMatch(/expired/i);
  });

  test("removing an administrator's factor ends their access at once, even with an unexpired aal2 token", async ({ page, request }) => {
    // The newcomer set up a factor in the test above.
    const service = process.env.ADMIN_E2E_SERVICE_KEY!;
    const admin = { apikey: service, Authorization: `Bearer ${service}` };
    // Its verified factor and secret, read from Supabase Auth's table (the admin users list does not include factors).
    const db = new pg.Client({ connectionString: process.env.ADMIN_E2E_DB_URL! });
    await db.connect();
    const row = (await db.query(
      "select f.id, f.secret, u.id as user_id from auth.mfa_factors f join auth.users u on u.id = f.user_id where u.email = $1 and f.status = 'verified'",
      [USERS.newcomer],
    )).rows[0] as { id: string; secret: string; user_id: string } | undefined;
    await db.end();
    expect(row, "the newcomer has a verified factor").toBeTruthy();
    const secret = row!.secret;
    const newcomer = { id: row!.user_id };
    const factor = { id: row!.id };
    await signIn(page, USERS.newcomer);
    await expect(page.getByTestId("mfa-verify")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("mfa-code").fill(totp(secret));
    await page.getByTestId("mfa-submit").click();
    await expect(page.getByTestId("admin-frame")).toBeVisible({ timeout: 30_000 });
    const token = await sessionToken(page);
    expect((await isAdminWith(request, token)).body).toBe("true");

    const removed = await request.delete(`${SUPABASE}/auth/v1/admin/users/${newcomer.id}/factors/${factor.id}`, { headers: admin });
    expect(removed.ok()).toBe(true);
    expect((await isAdminWith(request, token)).body, "no verified factor, so the old token is refused").toBe("false");
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
    await expect(page.getByLabel("Status", { exact: true })).toHaveValue("draft");
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
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
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
    await page.getByLabel("Status", { exact: true }).selectOption("published");
    await page.getByTestId("save-office").click();
    await expect(alertOf(page)).toContainText("outside the boundary");
    await expect(page.getByText("Tick the box above to accept it")).toBeVisible();
    await page.getByTestId("outside-reviewed").check();
    await page.getByTestId("save-office").click();
    // Accepted as outside the boundary, but an office is not published without reviewed evidence (P9-07).
    await expect(alertOf(page)).toContainText("address and location need reviewed evidence");
    await page.getByLabel("Status", { exact: true }).selectOption("draft");
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
    await expect(page.getByLabel("Status", { exact: true })).toHaveValue("draft");
    await expect(page.getByLabel("Status", { exact: true }).locator("option[value=active]")).toBeDisabled();
  });
});

test.describe("import", () => {
  const CSV = [
    "Company Name,Website,Domain,City,Address,Latitude,Longitude,Type,Stage,Industry,Accuracy,Neighborhood,Source URL,Verified at,Source covers,Address source url,Address verified at",
    'Imported One,https://imported-one.test,imported-one.test,Bengaluru,"1 Import Road, Indiranagar",12.978,77.640,startup,Series A,fintech,building,indiranagar,https://imported-one.test/about,2026-09-01,name;website;type;stage;industry;location,https://imported-one.test/contact,2026-09-02',
    "Imported One,,imported-one.test,Bengaluru,2 Import Road,12.97,77.64,startup,,,,,https://imported-one.test/contact,2026-09-02,address;location,,",
    "Imported One,,imported-one.test,Bengaluru,2 import road,12.97,77.64,startup,,,,,https://imported-one.test/contact,2026-09-02,address;location,,",
    "E2E Test Co,,e2e-test-co.test,Bengaluru,9 Attached Road,12.95,77.62,mnc,,,building,,https://e2e-test-co.test/offices,2026-09-03,address;location,,",
    ",,nameless.test,Bengaluru,3 Road,12.9,77.6,startup,,,,,https://nameless.test,2026-09-01,name;website;type;address;location,,",
    "Atlantis Co,,atlantis.test,Atlantis,4 Road,1,2,startup,,,,,https://atlantis.test,2026-09-01,name;website;type;address;location,,",
    "Stage Co,,stage.test,Chennai,5 Road,13.0,80.2,mnc,Seed,,,,https://stage.test,2026-09-01,name;website;type;stage;address;location,,",
    // P9-07: a row source counts only for the fields it lists, and a checked date cannot be in the future.
    "Thin Co,,thin.test,Chennai,6 Road,13.0,80.2,,,,,,https://thin.test,2026-09-01,name,,",
    "Future Co,,future.test,Chennai,7 Road,13.0,80.2,,,,,,https://future.test,2999-01-01,name;website;address;location,,",
  ].join("\n");

  test("previews what every row would do, then imports only the good ones as drafts", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/import");
    await page.getByTestId("csv-file").setInputFiles({ name: "companies.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });

    await expect(page.getByTestId("import-summary")).toContainText("9 rows: 1 new companies, 2 added offices, 1 already listed, 5 that cannot be imported", { timeout: 30_000 });
    const rows = page.getByTestId("import-rows").locator("tr");
    await expect(rows.nth(0)).toContainText("New company");
    await expect(rows.nth(1)).toContainText("Adds an office");
    await expect(rows.nth(2)).toContainText("Already listed, skipped");
    await expect(rows.nth(3)).toContainText("Adds an office");
    await expect(rows.nth(4)).toContainText("The company name is missing.");
    await expect(rows.nth(5)).toContainText("is not a city this site covers");
    await expect(rows.nth(6)).toContainText("needs the type startup");
    await expect(rows.nth(7)).toContainText("There is no evidence for the website");
    await expect(rows.nth(7)).toContainText("There is no evidence for the address");
    await expect(rows.nth(8)).toContainText("is in the future");
    await noSeriousViolations(page);

    await page.getByTestId("import-commit").click();
    await expect(page.getByTestId("import-report")).toContainText("1 companies created, 2 offices added, 0 skipped, 0 rows failed.", { timeout: 30_000 });

    await page.goto("/admin/companies?q=imported-one");
    const row = page.locator('[data-company="imported-one"]');
    await expect(row).toContainText("Draft");
    await expect(row).toContainText("Series A");
    await expect(row).toContainText("2");

    // The evidence came in with the rows, against the right records, as claims: the company cannot be published yet.
    await page.getByRole("link", { name: "Imported One" }).click();
    const panel = page.getByTestId("evidence-panel");
    await expect(panel.locator('tr[data-state="claimed"]', { hasText: "Name" })).toContainText("https://imported-one.test/about");
    await expect(panel.locator('tr[data-state="claimed"]', { hasText: "Office: 1 Import Road, Indiranagar" }).filter({ hasText: "Address" })).toContainText("https://imported-one.test/contact");
    await expect(panel.locator('tr[data-state="claimed"]', { hasText: "Sectors" })).toBeVisible();
    await expect(panel.getByTestId("publication-problems")).toContainText("The name needs reviewed evidence (it is claimed)");
    // An editor sees no review button.
    await expect(panel.getByTestId("review-evidence")).toHaveCount(0);
  });

  test("importing the same file again adds nothing: every row is recognised", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/import");
    await page.getByTestId("csv-file").setInputFiles({ name: "companies.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
    await expect(page.getByTestId("import-summary")).toContainText("0 new companies, 0 added offices, 4 already listed, 5 that cannot be imported", { timeout: 30_000 });
    await expect(page.getByTestId("import-commit")).toBeDisabled();
  });

  test("a file without the required columns says which are missing", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/import");
    await page.getByTestId("csv-file").setInputFiles({ name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("name,domain\nA,a.test") });
    await expect(alertOf(page)).toContainText("no column for: city, address, lat, lng, source_url, verified_at");
    await page.getByTestId("csv-file").setInputFiles({ name: "open.csv", mimeType: "text/csv", buffer: Buffer.from('name,domain\n"never closed,a.test') });
    await expect(alertOf(page)).toContainText("never closed");
  });

  test("the template download has the columns the import reads", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/import");
    const href = await page.getByTestId("template-link").getAttribute("href");
    const text = decodeURIComponent(href!.split(",").slice(1).join(","));
    const [header, example] = text.split("\n");
    expect(header).toBe(
      "name,domain,website_url,careers_url,description,types,startup_stage,ownership_status,sectors,city,address,lat,lng,accuracy,neighbourhood,tech_park," +
        "source_url,verified_at,source_covers,address_source_url,address_verified_at,location_source_url,location_verified_at",
    );
    // The example row lines up with the header (it did not before P9-07, after ownership_status was added).
    expect(parseCsvLine(example)).toHaveLength(header.split(",").length);
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

// The local Edge runtime sometimes answers 503 {"message":"name resolution failed"} (Docker's internal DNS on Windows, under
// memory pressure) from a lookup it makes itself, such as the signing keys, the database gateway, or the GitHub stand-in. It
// clears after a while. These helpers retry that exact answer for up to 90 seconds and nothing else: any other answer, and a
// 503 that does not clear, is returned (and fails the test with what the function said).
const isDnsFlake = (status: number, body: string) => status === 503 && body.includes("name resolution failed");

async function clickPublish(page: Page): Promise<{ status: number; body: string }> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    const answered = page.waitForResponse((r) => r.url().includes("/functions/v1/request-rebuild") && r.request().method() === "POST");
    await page.getByTestId("publish-now").click();
    const response = await answered;
    const body = await response.text().catch(() => "(no body)");
    if (!isDnsFlake(response.status(), body) || Date.now() > deadline) return { status: response.status(), body };
    await page.waitForTimeout(3_000);
    await expect(page.getByTestId("publish-now")).toBeEnabled();
  }
}

async function postRebuild(request: APIRequestContext, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    const response = await request.post(`${SUPABASE}/functions/v1/request-rebuild`, { headers });
    const body = await response.text();
    if (!isDnsFlake(response.status(), body) || Date.now() > deadline) return { status: response.status(), body };
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
}

test.describe("evidence and publication", () => {
  test("a reviewer cannot publish a company whose facts have no reviewed evidence, and the page says why", async ({ page }) => {
    await signInAs(page, "reviewer");
    await page.goto("/admin/companies?q=e2e-test");
    await page.getByRole("link", { name: "E2E Test Co" }).click();
    await expect(page.getByTestId("publication-problems")).toContainText("The name needs reviewed evidence (it is missing)");
    await page.getByTestId("company-form-status").selectOption("published");
    await page.getByTestId("save-company").click();
    await expect(alertOf(page)).toContainText("Publishing needs evidence");
    await page.reload();
    await expect(page.getByLabel("Status", { exact: true })).toHaveValue("draft");
  });

  test("an editor records evidence for each fact; it stays a claim, and the editor cannot review it", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/companies?q=e2e-test");
    await page.getByRole("link", { name: "E2E Test Co" }).click();
    const panel = page.getByTestId("evidence-panel");
    // A checked date in the future is refused by the database.
    await panel.getByTestId("evidence-target").selectOption({ label: "Company: Name" });
    await panel.getByTestId("evidence-source").fill("https://e2e-test-co.test/about");
    await panel.getByTestId("evidence-date").fill("2999-01-01");
    await panel.getByTestId("save-evidence").click();
    await expect(panel.locator('p[role="alert"]')).toContainText("in the future");

    for (const fact of ["Company: Name", "Company: Website", "Company: Description", "Company: Company type", "Company: Sectors"]) {
      await recordEvidence(page, fact, "https://e2e-test-co.test/about");
    }
    for (const fact of ["Office: Out of town: Address", "Office: Out of town: Location"]) {
      await recordEvidence(page, fact, "https://e2e-test-co.test/contact", "2026-08-20");
    }
    await expect(panel.locator('tr[data-state="claimed"]')).toHaveCount(9); // 7 recorded here, 2 from the imported "9 Attached Road" office
    await expect(panel.getByTestId("review-evidence")).toHaveCount(0);
    await expect(panel.getByTestId("publication-problems")).toContainText("The name needs reviewed evidence (it is claimed)");
  });

  test("the evidence tables and functions are closed to an editor's review and to the open API", async ({ page, request }) => {
    await signInAs(page, "editor");
    const token = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.includes("auth-token"));
      return key ? (JSON.parse(localStorage.getItem(key)!) as { access_token: string }).access_token : "";
    });
    expect(token).not.toBe("");
    const editor = { apikey: process.env.ADMIN_E2E_ANON_KEY!, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const claims = (await (await request.get(`${SUPABASE}/rest/v1/field_evidence?select=id&reviewed_at=is.null`, { headers: editor })).json()) as Array<{ id: number }>;
    expect(claims.length).toBeGreaterThan(0);
    const review = await request.post(`${SUPABASE}/rest/v1/rpc/review_evidence`, { headers: editor, data: { p_ids: [claims[0].id] } });
    expect(review.status()).toBeGreaterThanOrEqual(400);
    expect(await review.text()).toContain("only a reviewer or admin can review evidence");
    const patch = await request.patch(`${SUPABASE}/rest/v1/field_evidence?id=eq.${claims[0].id}`, {
      headers: { ...editor, Prefer: "return=representation" },
      data: { reviewed_at: new Date().toISOString() },
    });
    // Row-level security gives an editor no row to update.
    if (patch.ok()) expect(await patch.json()).toEqual([]);
    else expect(patch.status()).toBeGreaterThanOrEqual(400);
  });

  test("a reviewer reviews the evidence, publishes the office, and the company can be published", async ({ page }) => {
    await signInAs(page, "reviewer");
    await page.goto("/admin/companies?q=e2e-test");
    await page.getByRole("link", { name: "E2E Test Co" }).click();
    const panel = page.getByTestId("evidence-panel");
    await expect(panel.locator('tr[data-state="claimed"]')).toHaveCount(9); // 7 recorded here, 2 from the imported "9 Attached Road" office
    while ((await panel.getByTestId("review-evidence").count()) > 0) {
      const before = await panel.getByTestId("review-evidence").count();
      await panel.getByTestId("review-evidence").first().click();
      await expect(panel.getByTestId("review-evidence")).toHaveCount(before - 1);
    }
    await expect(panel.locator('tr[data-state="reviewed"]')).toHaveCount(9);
    // Reviewed evidence on a draft office is not enough: the office itself must be published first (20261007150000).
    await expect(panel).toContainText(/at least one published office needs reviewed evidence/i);
    const companyUrl = page.url();

    await page.goto("/admin/offices?q=Out%20of%20town");
    await page.getByRole("table", { name: "Offices" }).getByRole("link", { name: "Out of town" }).click();
    await expect(page).toHaveURL(/\/admin\/offices\/edit\?id=/);
    await expect(page.getByTestId("save-office")).toBeVisible();
    await page.getByLabel("Status", { exact: true }).selectOption("published");
    await page.getByTestId("save-office").click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

    await page.goto(companyUrl);
    await expect(page.getByTestId("evidence-panel").getByText("The evidence is enough to publish.")).toBeVisible();
  });

  test("the review page lists published companies whose facts are unsupported", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/review");
    // The synthetic seed was published without evidence: every one of its companies is flagged, and stays public.
    await expect(page.getByTestId("evidence-gap-rows").locator("tr").first()).toBeVisible();
    await noSeriousViolations(page);
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
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

    await page.goto("/admin");
    await expect(page.getByTestId("publish-now")).toBeEnabled();
    const answer = await clickPublish(page);
    expect(answer.status, `the request-rebuild answer was: ${answer.body}`).toBe(200);
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
    const answer = await clickPublish(page);
    expect(answer.status, `the request-rebuild answer was: ${answer.body}`).toBe(200);
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
    const refused = await postRebuild(request, { Authorization: `Bearer ${token}`, Origin: "http://localhost:3100" });
    expect(refused.status, refused.body).toBe(403);
    expect(JSON.parse(refused.body).error).toMatch(/reviewer or an admin/);
    const none = await postRebuild(request, { Origin: "http://localhost:3100" });
    expect(none.status, none.body).toBe(401);
    const wrongOrigin = await postRebuild(request, { Authorization: `Bearer ${token}`, Origin: "https://evil.example" });
    expect(wrongOrigin.status, wrongOrigin.body).toBe(403);
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

    const tables = ["admin_user", "audit_log", "submission", "feedback_rate", "link_click_daily", "heartbeat", "verification_check", "verification_check_default", "job_feed", "source", "site_state", "import_batch", "field_evidence", "publication_approval", "feed_event", "evidence_check", "evidence_refresh_policy"];
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
      ["evidence_report", { p_company: "00000000-0000-4000-8000-000000000001" }],
      ["publication_problems", { p_company: "00000000-0000-4000-8000-000000000001" }],
      ["review_evidence", { p_ids: [1] }],
      ["evidence_gaps", {}],
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

test.describe("employer feeds", () => {
  // A feed and a held change, as the pipeline would leave them, written straight to the local database.
  const DB = process.env.ADMIN_E2E_DB_URL!;
  let feedId = 0;
  test.beforeAll(async () => {
    const db = new pg.Client({ connectionString: DB });
    await db.connect();
    const company = (await db.query("select id, (select id from source limit 1) as source from company where domain = 'e2e-test-co.test'")).rows[0];
    feedId = (await db.query("insert into job_feed (company_id, source_id, provider, identifier) values ($1, $2, 'greenhouse', 'e2e-test-co') returning id", [company.id, company.source])).rows[0].id;
    const job = (await db.query(
      "insert into job (company_id, source_id, external_ref, title, apply_url, status) values ($1, $2, 'feed-1', 'Feed Engineer', 'https://e2e-test-co.test/jobs/feed-1', 'draft') returning id",
      [company.id, company.source],
    )).rows[0].id;
    await db.query(
      "insert into feed_event (feed_id, job_id, kind, field, old_value, new_value, external_ref) values ($1, $2, 'held_domain_change', 'apply_url', 'https://e2e-test-co.test/jobs/feed-1', 'https://job-boards.greenhouse.io/e2e-test-co/jobs/1', 'feed-1')",
      [feedId, job],
    );
    await db.end();
  });

  test("an editor sees feeds, held changes, and history, but cannot approve or resolve", async ({ page }) => {
    await signInAs(page, "editor");
    await page.goto("/admin/feeds");
    const feed = page.locator(`[data-feed="${feedId}"]`);
    await expect(feed).toHaveAttribute("data-approved", "false");
    await expect(feed).toContainText("Not approved: the pipeline does not read it.");
    await expect(feed.getByTestId("approve-feed")).toBeDisabled();
    await expect(page.getByTestId("held-rows")).toContainText("Held: the application link moved to another domain");
    await expect(page.getByTestId("apply-held").first()).toBeDisabled();
    await expect(page.getByTestId("reject-held").first()).toBeDisabled();
    await noSeriousViolations(page);
  });

  test("a reviewer must give a reason, approves the feed, and applies the held link", async ({ page }) => {
    await signInAs(page, "reviewer");
    await page.goto("/admin/feeds");
    const feed = page.locator(`[data-feed="${feedId}"]`);
    await feed.getByTestId("approve-feed").click();
    await expect(alertOf(page)).toContainText("Write a note saying why");
    await feed.getByTestId(`note-feed-${feedId}`).fill("Greenhouse board linked from the company's careers page");
    await feed.getByTestId("approve-feed").click();
    await expect(page.getByRole("status").filter({ hasText: "Approved" })).toBeVisible();
    await expect(feed).toHaveAttribute("data-approved", "true");
    await expect(feed).toContainText("by you: Greenhouse board linked from the company's careers page");

    const held = page.getByTestId("held-rows").locator("tr").first();
    await held.getByRole("textbox").fill("The careers page now links this board");
    await held.getByTestId("apply-held").click();
    await expect(page.getByRole("status").filter({ hasText: "Applied" })).toBeVisible();
    await expect(page.getByTestId("no-held")).toHaveText("Nothing is waiting.");
    await expect(page.getByTestId("history-rows")).toContainText("Applied");
    await expect(page.getByTestId("history-rows")).toContainText("The careers page now links this board");
  });
});

test.describe("logos", () => {
  // P9-21 / ADR-0024 on the real local stack: uploads wait in a private bucket, a reviewer approves, and only then is the
  // file public. Three small valid PNGs (the third has bytes after IEND, so it is a different file with a different hash).
  const DB = process.env.ADMIN_E2E_DB_URL!;
  const PNG_A = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
  const PNG_B = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  const PNG_C = Buffer.concat([PNG_A, Buffer.from("third")]);
  const TERMS = "Partners and press may use our logo, unaltered, to refer to us";
  let companyId = "";
  const sha = async (b: Buffer) => (await import("node:crypto")).createHash("sha256").update(b).digest("hex");
  const publicUrl = (key: string) => `${SUPABASE}/storage/v1/object/public/company-logos/${key}`;
  const logoKey = async () => {
    const db = new pg.Client({ connectionString: DB });
    await db.connect();
    const key = (await db.query("select logo_key from company where id = $1", [companyId])).rows[0].logo_key as string | null;
    await db.end();
    return key;
  };
  /** The signed-in user's access token, as the admin page holds it. */
  const tokenOf = (page: Page) =>
    page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.startsWith("sb-") && x.endsWith("-auth-token"))!;
      return (JSON.parse(localStorage.getItem(k)!) as { access_token: string }).access_token;
    });

  async function fillUpload(page: Page, file: { name: string; mimeType: string; buffer: Buffer } | null, opts: { terms?: string; atlas?: boolean } = {}) {
    const panel = page.getByTestId("logo-panel");
    if (file) await panel.getByTestId("logo-file").setInputFiles(file);
    await panel.getByTestId("logo-source").fill("https://e2e-test-co.test/brand/logo.png");
    await panel.getByTestId("logo-use").selectOption("company_brand_assets");
    await panel.getByTestId("logo-permission-url").fill("https://e2e-test-co.test/brand");
    await panel.getByTestId("logo-note").fill("Brand guidelines page, section Logo use");
    await panel.getByTestId("logo-obtained").fill("2026-10-01");
    await panel.getByTestId("logo-terms").fill(opts.terms ?? TERMS);
    await panel.getByTestId("logo-allows-storage").check();
    await panel.getByTestId("logo-allows-display").check();
    if (opts.atlas ?? true) await panel.getByTestId("logo-allows-atlas").check();
    else await panel.getByTestId("logo-allows-atlas").uncheck();
    await panel.getByTestId("upload-logo").click();
  }
  const openCompany = (page: Page) => page.goto(`/admin/companies/edit?id=${companyId}`);

  test.beforeAll(async () => {
    const db = new pg.Client({ connectionString: DB });
    await db.connect();
    companyId = (await db.query("select id from company where domain = 'e2e-test-co.test'")).rows[0].id;
    await db.end();
  });

  test("an editor's upload is checked, recorded, kept private, and cannot be approved by the editor", async ({ page, request }) => {
    await signInAs(page, "editor");
    await openCompany(page);
    const panel = page.getByTestId("logo-panel");
    await expect(panel.getByTestId("current-logo")).toHaveText("No logo: the site shows the first letter of the name.");
    await panel.getByTestId("upload-logo").click();
    await expect(panel.getByRole("alert").or(panel.locator('[role="status"]')).first()).toContainText("Choose the logo file.");
    await fillUpload(page, { name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
    await expect(panel).toContainText("SVG is not accepted");
    await fillUpload(page, { name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(1_048_577, 1) });
    await expect(panel).toContainText("at most 1 MB");
    await fillUpload(page, { name: "a.png", mimeType: "image/png", buffer: PNG_A }, { terms: "official logo" });
    await expect(panel).toContainText("Being the official logo is not permission by itself");
    await fillUpload(page, { name: "a.png", mimeType: "image/png", buffer: PNG_A }, { atlas: false });
    await expect(panel).toContainText("The terms must allow all three uses");
    await fillUpload(page, { name: "a.png", mimeType: "image/png", buffer: PNG_A });
    await expect(panel).toContainText("Uploaded. A reviewer approves it before it becomes the logo.");
    const row = panel.locator('[data-decision="pending"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(TERMS);
    await expect(row.getByTestId("approve-logo")).toBeDisabled();
    await noSeriousViolations(page);

    const keyA = `${companyId}/${await sha(PNG_A)}.png`;
    expect((await request.get(publicUrl(keyA))).status(), "an unapproved logo is not public").toBeGreaterThanOrEqual(400);
    // Past the page, with the editor's own (aal2) token: no approving, and no writing to the public bucket.
    const token = await tokenOf(page);
    const anon = process.env.ADMIN_E2E_ANON_KEY!;
    const auth = { apikey: anon, Authorization: `Bearer ${token}` };
    const id = (await request.get(`${SUPABASE}/rest/v1/logo_asset?select=id&company_id=eq.${companyId}`, { headers: auth }).then((r) => r.json()))[0].id;
    const approve = await request.post(`${SUPABASE}/rest/v1/rpc/review_logo`, { headers: auth, data: { p_id: id, p_decision: "approved", p_note: "mine" } });
    expect(approve.status()).toBe(403);
    const sneak = await request.post(`${SUPABASE}/storage/v1/object/company-logos/${keyA}`, { headers: { ...auth, "Content-Type": "image/png" }, data: PNG_A });
    expect(sneak.status(), "an editor cannot write to the public bucket").toBeGreaterThanOrEqual(400);
    expect(await logoKey()).toBeNull();
  });

  test("a reviewer approves it, and only then is it the logo and public", async ({ page, request }) => {
    await signInAs(page, "reviewer");
    await openCompany(page);
    const panel = page.getByTestId("logo-panel");
    const row = panel.locator('[data-decision="pending"]');
    // SEC-2 (20261007150000): even a reviewer cannot copy an undecided upload into the public bucket.
    const keyUndecided = `${companyId}/${await sha(PNG_A)}.png`;
    const reviewerAuth = { apikey: process.env.ADMIN_E2E_ANON_KEY!, Authorization: `Bearer ${await tokenOf(page)}` };
    const early = await request.post(`${SUPABASE}/storage/v1/object/copy`, {
      headers: reviewerAuth,
      data: { bucketId: "company-logos-pending", sourceKey: keyUndecided, destinationBucket: "company-logos", destinationKey: keyUndecided },
    });
    expect(early.status(), "an undecided upload cannot be copied to the public bucket").toBeGreaterThanOrEqual(400);
    expect((await request.get(publicUrl(keyUndecided))).status()).toBeGreaterThanOrEqual(400);
    await row.getByTestId("approve-logo").click();
    await expect(panel).toContainText("Write a note saying why.");
    await row.getByRole("textbox", { name: "Reason for the decision" }).fill("Brand guidelines allow partner use; current logo");
    await row.getByTestId("approve-logo").click();
    await expect(panel).toContainText("Approved: it is now the logo.");
    const keyA = `${companyId}/${await sha(PNG_A)}.png`;
    await expect(panel.getByTestId("current-logo")).toContainText(keyA);
    expect(await logoKey()).toBe(keyA);
    const pub = await request.get(publicUrl(keyA));
    expect(pub.status()).toBe(200);
    expect(pub.headers()["content-type"]).toContain("image/png");
    await expect(panel.locator('[data-decision="approved"]')).toContainText("Approved: Brand guidelines allow partner use");
  });

  test("a replacement is approved in its place, and a rejected upload never becomes public or the logo", async ({ page, request }) => {
    await signInAs(page, "editor");
    await openCompany(page);
    await fillUpload(page, { name: "b.png", mimeType: "image/png", buffer: PNG_B });
    await expect(page.getByTestId("logo-panel")).toContainText("Uploaded.");
    await fillUpload(page, { name: "c.png", mimeType: "image/png", buffer: PNG_C });
    await expect(page.getByTestId("logo-panel").locator('[data-decision="pending"]')).toHaveCount(2);
    await page.getByRole("button", { name: "Sign out" }).click();

    await signInAs(page, "reviewer");
    await openCompany(page);
    const panel = page.getByTestId("logo-panel");
    const keyB = `${companyId}/${await sha(PNG_B)}.png`;
    const keyC = `${companyId}/${await sha(PNG_C)}.png`;
    // Rows are newest first: C, then B. Once C is rejected, B is the only pending row.
    const pending = panel.locator('[data-decision="pending"]');
    const rowC = pending.first();
    const rowB = pending.first();
    await rowC.getByRole("textbox", { name: "Reason for the decision" }).fill("Not the current logo");
    await rowC.getByTestId("reject-logo").click();
    await expect(panel).toContainText("Rejected.");
    await expect(pending).toHaveCount(1);
    await rowB.getByRole("textbox", { name: "Reason for the decision" }).fill("New brand mark, guidelines checked");
    await rowB.getByTestId("approve-logo").click();
    await expect(panel).toContainText("Approved: it is now the logo.");
    expect(await logoKey()).toBe(keyB);
    expect((await request.get(publicUrl(keyB))).status()).toBe(200);
    expect((await request.get(publicUrl(keyC))).status(), "a rejected upload is never public").toBeGreaterThanOrEqual(400);
    // SEC-2: and it can never be copied there afterwards.
    const reviewerAuth = { apikey: process.env.ADMIN_E2E_ANON_KEY!, Authorization: `Bearer ${await tokenOf(page)}` };
    const late = await request.post(`${SUPABASE}/storage/v1/object/copy`, {
      headers: reviewerAuth,
      data: { bucketId: "company-logos-pending", sourceKey: keyC, destinationBucket: "company-logos", destinationKey: keyC },
    });
    expect(late.status(), "a rejected upload cannot be copied to the public bucket").toBeGreaterThanOrEqual(400);
    expect((await request.get(publicUrl(keyC))).status()).toBeGreaterThanOrEqual(400);
  });

  test("a password-only session cannot read, upload, or approve logos", async ({ request }) => {
    const anon = process.env.ADMIN_E2E_ANON_KEY!;
    const token = (await (await request.post(`${SUPABASE}/auth/v1/token?grant_type=password`, { headers: { apikey: anon }, data: { email: USERS.reviewer, password: PASSWORD } })).json()).access_token as string;
    const auth = { apikey: anon, Authorization: `Bearer ${token}` };
    expect(await (await request.get(`${SUPABASE}/rest/v1/logo_asset?select=id`, { headers: auth })).json()).toEqual([]);
    const up = await request.post(`${SUPABASE}/storage/v1/object/company-logos-pending/${companyId}/${"0".repeat(64)}.png`, { headers: { ...auth, "Content-Type": "image/png" }, data: PNG_A });
    expect(up.status()).toBeGreaterThanOrEqual(400);
    const approve = await request.post(`${SUPABASE}/rest/v1/rpc/review_logo`, { headers: auth, data: { p_id: 1, p_decision: "approved", p_note: "x" } });
    expect(approve.status()).toBe(403);
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
