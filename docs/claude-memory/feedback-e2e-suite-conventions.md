---
name: feedback-e2e-suite-conventions
description: How the Playwright suite is meant to be run and written here (workers, timeouts, hold gates, injected clocks, key and no-key runs)
metadata:
  type: feedback
---

- Map pages run **software WebGL**, so the suite uses 3 workers locally (2 in CI) and a 60 s timeout; the logo and animation specs set 120 s. Six workers made unrelated specs time out.
- Run the full suite **twice**: with the Geoapify key, and with `NEXT_PUBLIC_GEOAPIFY_KEY=` empty (CI has no key; the 10 basemap cases skip). Both must pass.
- Never assert "nothing has arrived yet" against a fixed delay: it races a loaded machine. Use the page's `hold` gate (`window.__logoControl.hold`) or the layer's injected clock (`window.__layerNow`), which make the state deterministic.
- Read WebGL pixels inside a MapLibre `render` handler (draw the canvas to a 2D canvas). `page.screenshot` can show a stale frame during animation.
- Rings are 2 to 3 px and anti-aliased: scan across a band for the exact token colour instead of sampling one pixel.
- After adding a test, check that it can fail: change the code under test, see it fail, restore it. Several tests here were checked that way.

**Why:** each of these produced a false pass or a flaky failure during P2-03 to P2-05.

**How to apply:** follow them when adding or debugging browser tests. See [[feedback-stale-test-server]].
