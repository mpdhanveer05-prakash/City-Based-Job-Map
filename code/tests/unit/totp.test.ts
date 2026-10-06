// The admin e2e specs play the authenticator app with tests/admin/totp.ts (P9-13): check it against RFC 6238.
import { describe, expect, it } from "vitest";
import { totp } from "@/tests/admin/totp";

// RFC 6238 appendix B, SHA-1 secret "12345678901234567890" (base32 below); the RFC prints 8 digits, an app shows the last 6.
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totp", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("at %i s gives %s", (seconds, code) => {
    expect(totp(SECRET, seconds * 1000)).toBe(code);
  });

  it("refuses a secret that is not base32", () => {
    expect(() => totp("not base32!")).toThrow(/base32/);
  });
});
