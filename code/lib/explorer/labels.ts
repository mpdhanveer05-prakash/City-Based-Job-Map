// The words the explorer uses for the filter values (design-system.md §7: sentence case, the confirmed names).
import type { CompanyType, StartupStage } from "../filters/schema";

export const TYPE_LABELS: Record<CompanyType, string> = { startup: "Startup", mnc: "MNC", product: "Product" };

export const STAGE_LABELS: Record<StartupStage, string> = {
  pre_seed: "Pre-seed",
  seed: "Seed",
  bootstrapped: "Bootstrapped",
  series_a: "Series A",
  series_b: "Series B",
  series_c: "Series C",
  series_c_plus: "Series C+",
  public: "Public",
  acquired: "Acquired",
};

/** How exact an office's position is, as a sentence fragment: "Accurate to the building". */
export const ACCURACY_LABELS: Record<string, string> = {
  rooftop: "rooftop",
  building: "building",
  campus: "campus",
  street: "street",
  locality: "locality",
};

/** "1 company", "38 companies". */
export const companies = (n: number): string => `${n} ${n === 1 ? "company" : "companies"}`;
export const offices = (n: number): string => `${n} ${n === 1 ? "office" : "offices"}`;
export const jobs = (n: number): string => `${n} open ${n === 1 ? "job" : "jobs"}`;

/** "38 companies in 41 offices" (design-system.md §7). */
export const resultSummary = (companyCount: number, officeCount: number): string => `${companies(companyCount)} in ${offices(officeCount)}`;
