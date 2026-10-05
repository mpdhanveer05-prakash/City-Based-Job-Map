// Zod 4 tests whether the page may compile code (`Function("")`) before it builds a faster parser. Under our
// Content-Security-Policy (no 'unsafe-eval', lib/csp.ts) that test is refused, which works, but the browser reports each
// refusal as a violation. The pages never need the compiled parsers (their inputs are a URL and a few small datasets), so
// turn the compile off and the probe never runs. Imported by every browser module that builds a schema.
import { z } from "zod";

z.config({ jitless: true });
