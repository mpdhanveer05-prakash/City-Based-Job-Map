import { describe, expect, it } from "vitest";
import { flatSegmentName } from "@/lib/segment-files";

describe("flatSegmentName (P9-17)", () => {
  it("joins a nested Windows export path into the name the client requests", () => {
    expect(flatSegmentName(["__next.admin", "companies", "__PAGE__.txt"])).toBe("__next.admin.companies.__PAGE__.txt");
    expect(flatSegmentName(["__next.!KHB1YmxpYyk", "companies", "$d$slug", "__PAGE__.txt"])).toBe("__next.!KHB1YmxpYyk.companies.$d$slug.__PAGE__.txt");
  });
  it("refuses anything that is not a nested segment file", () => {
    expect(() => flatSegmentName(["__next._tree.txt"])).toThrow();
    expect(() => flatSegmentName(["other", "x.txt"])).toThrow();
  });
});
