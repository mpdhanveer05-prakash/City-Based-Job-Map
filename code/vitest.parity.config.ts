import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The parity tests need a running local database (`npx supabase db start`, then `db reset`).
// They are not part of `npm test`; run them with `npm run test:parity`.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["tests/parity/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
