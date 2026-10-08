// Zod 4 tests whether the page may compile code (`Function("")`) before it builds a faster parser. Under our
// Content-Security-Policy (no 'unsafe-eval', lib/csp.ts) that test is refused, which works, but the browser reports each
// refusal as a violation. The pages never need the compiled parsers (their inputs are a URL and a few small datasets), so
// turn the compile off and the probe never runs. Imported by every browser module that builds a schema.
// `zod/mini` (P9-12): the full `zod` entry pulls every locale and the JSON-schema converters into the browser. The setting
// is Zod's shared core configuration, so it applies to `zod` and `zod/mini` schemas alike.
import { config } from "zod/mini";

config({ jitless: true });
