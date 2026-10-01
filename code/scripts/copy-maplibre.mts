// Copies MapLibre's runtime modules to public/maplibre/<version>/ so they are served unhashed.
//
// MapLibre 6 finds its web worker by file name (maplibre-gl-worker.mjs), and the worker imports
// ./maplibre-gl-shared.mjs. Turbopack renames both with content hashes, so a bundled MapLibre
// can't start its worker ("Worker failed to load"). Served as plain files from the same origin,
// it works and also needs no worker-src beyond 'self'. The version is in the path, so the files
// are immutable. Runs before `dev` and `build`; public/maplibre/ is git-ignored.
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "node_modules", "maplibre-gl", "dist");
const { version } = JSON.parse(readFileSync(join(root, "node_modules", "maplibre-gl", "package.json"), "utf8"));
const target = join(root, "public", "maplibre");

rmSync(target, { recursive: true, force: true });
mkdirSync(join(target, version), { recursive: true });
for (const file of ["maplibre-gl.mjs", "maplibre-gl-shared.mjs", "maplibre-gl-worker.mjs"]) {
  cpSync(join(dist, file), join(target, version, file));
}
console.log(`MapLibre ${version} copied to public/maplibre/${version}/`);
