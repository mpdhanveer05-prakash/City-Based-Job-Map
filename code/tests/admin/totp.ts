// RFC 6238 TOTP codes for the admin e2e specs (P9-13): the test plays the administrator's authenticator app.
import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32(secret: string): Buffer {
  let bits = "";
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error("not a base32 secret");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** The six-digit code for `secret` at `at` (ms), with 30-second steps. */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const mac = createHmac("sha1", base32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const value = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
}
