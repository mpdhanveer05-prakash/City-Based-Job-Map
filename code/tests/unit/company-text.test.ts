import { describe, expect, it } from "vitest";
import { locationLine, metaDescription, safeJsonLd, typeSentence, verifiedText } from "@/lib/company-text";
import { freshnessText } from "@/components/company/freshness";
import { isExplorerPath, recallExplorer, rememberExplorer } from "@/lib/explorer/last-explorer";
import { clickEndpoint, sendClick } from "@/lib/beacon";

describe("typeSentence", () => {
  it("names the types and the stage", () => {
    expect(typeSentence(["startup", "product"], "series_a")).toBe("Startup and Product company, Series A");
    expect(typeSentence(["mnc"], null)).toBe("MNC company");
    expect(typeSentence(["startup", "mnc", "product"], null)).toBe("Startup, MNC and Product company");
  });
  it("shows a stage only for a Startup, and never guesses one", () => {
    expect(typeSentence(["mnc"], "seed")).toBe("MNC company");
    expect(typeSentence(["startup"], null)).toBe("Startup company");
    expect(typeSentence([], null)).toBe("");
  });
});

describe("locationLine", () => {
  const office = (cityName: string, area: string | null, address = "1 Test Road") => ({ cityName, area, address });
  it("gives the area and the city for one office, the address when there is no area", () => {
    expect(locationLine([office("Bengaluru", "Koramangala")])).toBe("Koramangala, Bengaluru");
    expect(locationLine([office("Bengaluru", null)])).toBe("1 Test Road, Bengaluru");
  });
  it("counts offices and names each city once", () => {
    expect(locationLine([office("Bengaluru", "A"), office("Bengaluru", "B"), office("Chennai", "C")])).toBe("3 offices in Bengaluru and Chennai");
    expect(locationLine([office("Bengaluru", "A"), office("Bengaluru", "B")])).toBe("2 offices in Bengaluru");
    expect(locationLine([])).toBe("");
  });
});

describe("verifiedText and freshnessText", () => {
  it("never makes up a date", () => {
    expect(verifiedText(null)).toBe("Not yet verified");
    expect(verifiedText("garbage")).toBe("Not yet verified");
    expect(verifiedText("2026-09-12T10:00:00Z")).toBe("Verified 12 Sep 2026");
    expect(freshnessText(null, Date.now())).toBe("Not yet checked");
    expect(freshnessText("garbage", Date.now())).toBe("Not yet checked");
  });
  it("counts whole days, and falls back to a date for old checks", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(freshnessText("2026-10-05T01:00:00Z", now)).toBe("Checked today");
    expect(freshnessText("2026-10-04T09:00:00Z", now)).toBe("Checked yesterday");
    expect(freshnessText("2026-10-03T09:00:00Z", now)).toBe("Checked 2 days ago");
    expect(freshnessText("2026-10-06T09:00:00Z", now)).toBe("Checked today"); // a clock a little ahead is not negative
    expect(freshnessText("2026-05-01T00:00:00Z", now)).toMatch(/^Checked on 1 May 2026$/);
  });
});

describe("metaDescription and safeJsonLd", () => {
  it("uses the description, cut at a word under 160 characters", () => {
    const long = "word ".repeat(80).trim();
    const text = metaDescription({ name: "Acme", description: long, types: [] }, "");
    expect(text.length).toBeLessThanOrEqual(160);
    expect(text.endsWith("…")).toBe(true);
    expect(text).not.toMatch(/\bwor…$/);
  });
  it("falls back to the name and place, without inventing a description", () => {
    expect(metaDescription({ name: "Acme", description: null, types: [] }, "Koramangala, Bengaluru")).toBe("Acme: Koramangala, Bengaluru.");
    expect(metaDescription({ name: "Acme", description: "  ", types: [] }, "")).toBe("Acme.");
  });
  it("escapes everything that could close a script tag", () => {
    const out = safeJsonLd({ name: "</script><script>alert(1)</script>", note: "a b" });
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script>");
  });
});

describe("last explorer", () => {
  const store = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };
  it("remembers and recalls an explorer path", () => {
    const s = store();
    rememberExplorer("/bangalore?type=startup&map=12.97%2C77.59%2C11.00", s);
    expect(recallExplorer(s)).toBe("/bangalore?type=startup&map=12.97%2C77.59%2C11.00");
  });
  it("accepts only a path into an explorer, never another site or a script", () => {
    for (const bad of ["https://evil.example/bangalore", "//evil.example", "javascript:alert(1)", "/admin", "/bangalore/../x", "/bangalore?x=<script>", "/mumbai", ""]) {
      expect(isExplorerPath(bad), bad).toBe(false);
      const s = store();
      rememberExplorer(bad, s);
      expect(recallExplorer(s), bad).toBeNull();
    }
    expect(isExplorerPath("/chennai")).toBe(true);
  });
  it("ignores a stored value that is not an explorer path, and storage that throws", () => {
    expect(recallExplorer({ getItem: () => "https://evil.example" })).toBeNull();
    expect(recallExplorer({ getItem: () => { throw new Error("blocked"); } })).toBeNull();
    expect(() => rememberExplorer("/bangalore", { setItem: () => { throw new Error("full"); } })).not.toThrow();
    expect(recallExplorer(undefined)).toBeNull();
  });
});

describe("click beacon", () => {
  it("has no endpoint without a Supabase project", () => {
    expect(clickEndpoint(undefined)).toBeNull();
    expect(clickEndpoint("replace-with-url")).toBeNull();
    expect(clickEndpoint("https://abc.supabase.co/")).toBe("https://abc.supabase.co/functions/v1/click");
  });
  it("sends a kind and an id as text/plain, and nothing else", async () => {
    const calls: Array<[string, Blob]> = [];
    const nav = { sendBeacon: (url: string, data: BodyInit | null | undefined) => (calls.push([url, data as Blob]), true) };
    expect(sendClick("apply", "id-1", nav, "https://abc.supabase.co/functions/v1/click")).toBe(true);
    const [url, blob] = calls[0];
    expect(url).toBe("https://abc.supabase.co/functions/v1/click");
    expect(blob.type.toLowerCase()).toBe("text/plain;charset=utf-8");
    expect(JSON.parse(await blob.text())).toEqual({ kind: "apply", id: "id-1" });
  });
  it("does nothing, and says so, when there is no endpoint, no sendBeacon, or it throws", () => {
    expect(sendClick("apply", "x", { sendBeacon: () => true }, null)).toBe(false);
    expect(sendClick("apply", "x", undefined, "https://a.b/c")).toBe(false);
    expect(sendClick("apply", "x", { sendBeacon: () => { throw new Error("blocked"); } }, "https://a.b/c")).toBe(false);
    expect(sendClick("apply", "x", { sendBeacon: () => false }, "https://a.b/c")).toBe(false);
  });
});
