// Prints the Worker version serving all traffic, from the JSON of `wrangler deployments status --json` (lib/release.ts):
//
//   npx wrangler deployments status --json > status.json && node scripts/worker-version.mts status.json
//
// Exit 1 when the version cannot be read, so a refresh stops before it deploys anything it could not roll back.
import { readFileSync } from "node:fs";
import { deployedVersionId } from "../lib/release.ts";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/worker-version.mts <wrangler deployments status --json output>");
  process.exit(2);
}
try {
  console.log(deployedVersionId(JSON.parse(readFileSync(file, "utf8"))));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
