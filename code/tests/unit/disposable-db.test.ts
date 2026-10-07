import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { refusal } from "../disposable-db";
import { MARKER_SQL, TEST_PROJECT_ID, testConfig } from "../../scripts/test-stack.mts";

const TEST_URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const MAIN_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("the test database guard", () => {
  it("accepts only the disposable test stack", () => {
    expect(refusal(TEST_URL, { port: 55322, marker: "company-map-test", realCompanies: 0 })).toBeNull();
  });

  it("refuses the main local database, even with a marker", () => {
    expect(refusal(MAIN_URL, { port: 54322, marker: "company-map-test", realCompanies: 0 })).toMatch(/main local database/);
  });

  it("refuses a database without the test-stack marker", () => {
    expect(refusal(TEST_URL, { port: 55322, marker: null, realCompanies: 0 })).toMatch(/no test_stack.marker/);
  });

  it("refuses a database that holds real companies (the pilot drafts)", () => {
    expect(refusal(TEST_URL, { port: 55322, marker: "company-map-test", realCompanies: 46 })).toMatch(/46 real/);
  });

  it("never prints the password", () => {
    expect(refusal(MAIN_URL, { port: 54322, marker: null, realCompanies: 0 })).not.toContain("postgres:postgres");
  });
});

describe("the test stack's config", () => {
  const main = readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8");
  const config = testConfig(main);

  it("has its own project id, so its own containers and volumes", () => {
    expect(config).toContain(`project_id = "${TEST_PROJECT_ID}"`);
    expect(config).not.toMatch(/^project_id = "company-map"$/m);
  });

  it("moves every port away from the main stack", () => {
    for (const port of ["54320", "54321", "54322", "54323", "54324", "54327", "54329"]) {
      expect(config).not.toMatch(new RegExp(`^\\s*(port|shadow_port)\\s*=\\s*${port}\\b`, "m"));
    }
    expect(config).toMatch(/^port = 55322/m);
  });

  it("refuses a config port it has no mapping for, instead of sharing it", () => {
    expect(() => testConfig(`${main}\n[extra]\nport = 61234\n`)).toThrow(/no test-stack mapping/);
  });

  it("seeds the marker the guards look for", () => {
    expect(MARKER_SQL).toContain("test_stack.marker");
    expect(MARKER_SQL).toContain(TEST_PROJECT_ID);
  });
});
