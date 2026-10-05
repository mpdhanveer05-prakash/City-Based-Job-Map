import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchCitySnapshot, parseCitySnapshot } from "@/lib/api/snapshot";
import { citySnapshotSchema, type CitySnapshot } from "@/lib/filters/dataset";
import { DATASET_FILE_NAMES, buildManifest, datasetPath, serializeDataset } from "@/lib/filters/dataset-files";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const snapshot: CitySnapshot = citySnapshotSchema.parse({
  version: 1,
  city: { slug: "chennai", name: "Chennai", aliases: ["Madras"], status: "beta", centre: [80.27, 13.08], default_zoom: 11, data_version: 3,
    boundary: { type: "MultiPolygon", coordinates: [[[[80.1, 12.85], [80.33, 12.85], [80.33, 13.2], [80.1, 13.2], [80.1, 12.85]]]] } },
  synthetic_companies: 1,
  neighbourhoods: [{ slug: "adyar", name: "Adyar" }],
  tech_parks: [],
  sectors: [{ slug: "saas", name: "SaaS" }],
  companies: [
    {
      id: id(1), slug: "amber-forge-synthetic", name: "Amber Forge (synthetic)", logo_key: null, description: "Synthetic.",
      website_url: "https://amber-forge-synthetic.example", careers_url: null, startup_stage: "seed", last_verified_at: null,
      types: ["startup"], sectors: ["saas"], founders: [],
    },
  ],
  offices: [
    { id: id(11), company_id: id(1), lng: 80.25, lat: 13.0, accuracy: "building", address: "Synthetic address 1", neighbourhood: "adyar", tech_park: null },
  ],
  jobs: [
    { id: id(21), company_id: id(1), title: "Backend Engineer", apply_url: "https://amber-forge-synthetic.example/careers/1", status: "active", last_checked_at: null },
  ],
});

describe("serializeDataset", () => {
  it("writes the four files, as compact JSON", () => {
    const set = serializeDataset(snapshot);
    expect(Object.keys(set.files)).toEqual([...DATASET_FILE_NAMES]);
    expect(set.city).toBe("chennai");
    expect(set.dataVersion).toBe(3);
    expect(set.counts).toEqual({ companies: 1, offices: 1, jobs: 1 });
    expect(set.synthetic).toBe(true);
    for (const text of Object.values(set.files)) {
      expect(text).not.toMatch(/\n/);
      expect(() => JSON.parse(text)).not.toThrow();
    }
  });

  it("gives the same bytes for the same data", () => {
    expect(serializeDataset(snapshot)).toEqual(serializeDataset(structuredClone(snapshot)));
  });

  it("keeps the explorer files small: the description lives only in details.json", () => {
    const set = serializeDataset(snapshot);
    expect(set.files.companies).not.toContain("Synthetic.");
    expect(set.files.details).toContain("Synthetic.");
    expect(set.files.search).toContain("Backend Engineer");
  });
});

describe("manifest", () => {
  it("names each file by city and version and records its size", () => {
    const set = serializeDataset(snapshot);
    const manifest = buildManifest([set]);
    expect(manifest.version).toBe(1);
    expect(manifest.cities.chennai.data_version).toBe(3);
    expect(manifest.cities.chennai.files.companies.path).toBe("/data/chennai/3/companies.json");
    expect(manifest.cities.chennai.files.details.bytes).toBe(new TextEncoder().encode(set.files.details).length);
    expect(datasetPath("bangalore", 12, "offices")).toBe("/data/bangalore/12/offices.json");
  });

  it("counts bytes, not characters", () => {
    const wide = structuredClone(snapshot);
    wide.companies[0].name = "ಬೆಂಗಳೂರು Systems (synthetic)";
    const set = serializeDataset(wide);
    expect(buildManifest([set]).cities.chennai.files.companies.bytes).toBeGreaterThan(set.files.companies.length);
  });

  it("has no timestamp and orders cities by name, so a rebuild is byte-identical", () => {
    const a = serializeDataset(snapshot);
    const b = serializeDataset({ ...snapshot, city: { ...snapshot.city, slug: "bangalore", name: "Bengaluru" } });
    expect(JSON.stringify(buildManifest([a, b]))).toBe(JSON.stringify(buildManifest([b, a])));
    expect(Object.keys(buildManifest([a, b]).cities)).toEqual(["bangalore", "chennai"]);
    expect(JSON.stringify(buildManifest([a]))).not.toMatch(/20\d\d-\d\d-\d\d/);
  });
});

describe("parseCitySnapshot", () => {
  it("accepts a valid snapshot for the city that was asked for", () => {
    expect(parseCitySnapshot(structuredClone(snapshot), "chennai").city.slug).toBe("chennai");
  });

  it("rejects a snapshot for another city", () => {
    expect(() => parseCitySnapshot(structuredClone(snapshot), "bangalore")).toThrow(/asked for bangalore but received chennai/);
  });

  it("rejects bad data with the path of the first problem", () => {
    const bad = structuredClone(snapshot);
    bad.companies[0].website_url = "http://insecure.example";
    expect(() => parseCitySnapshot(bad, "chennai")).toThrow(/companies\.0\.website_url/);
    expect(() => parseCitySnapshot({ version: 2 }, "chennai")).toThrow(/does not match the schema/);
    expect(() => parseCitySnapshot("nonsense", "chennai")).toThrow(/does not match the schema/);
  });
});

describe("fetchCitySnapshot over HTTP", () => {
  let server: Server;
  let baseUrl: string;
  let lastRequest: { method?: string; url?: string; headers: IncomingMessage["headers"]; body: string };
  let reply: { status: number; body: string } = { status: 200, body: "null" };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        lastRequest = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() };
        res.writeHead(reply.status, { "Content-Type": "application/json" });
        res.end(reply.body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("calls the RPC with the anon key and the city, and returns the validated snapshot", async () => {
    reply = { status: 200, body: JSON.stringify(snapshot) };
    const result = await fetchCitySnapshot({ url: `${baseUrl}/`, anonKey: "anon-key-123" }, "chennai");
    expect(result.city.slug).toBe("chennai");
    expect(lastRequest.method).toBe("POST");
    expect(lastRequest.url).toBe("/rest/v1/rpc/city_build_snapshot");
    expect(lastRequest.headers.apikey).toBe("anon-key-123");
    expect(lastRequest.headers.authorization).toBe("Bearer anon-key-123");
    expect(JSON.parse(lastRequest.body)).toEqual({ city_slug: "chennai" });
  });

  it("fails on a null answer (an unknown city, or one hidden from anon)", async () => {
    reply = { status: 200, body: "null" };
    await expect(fetchCitySnapshot({ url: baseUrl, anonKey: "k" }, "chennai")).rejects.toThrow(/returned null/);
  });

  it("fails with the status and a trimmed body on an HTTP error", async () => {
    reply = { status: 401, body: JSON.stringify({ message: "Invalid API key" }) };
    await expect(fetchCitySnapshot({ url: baseUrl, anonKey: "bad" }, "chennai")).rejects.toThrow(/HTTP 401.*Invalid API key/);
  });

  it("fails on data that does not match the schema instead of returning part of it", async () => {
    reply = { status: 200, body: JSON.stringify({ ...snapshot, companies: [{ id: "x" }] }) };
    await expect(fetchCitySnapshot({ url: baseUrl, anonKey: "k" }, "chennai")).rejects.toThrow(/does not match the schema/);
  });
});
