# Real-device map test procedure (P2-09, D-06)

Prepared 6 Oct 2026. It turns [map-spec §10](map-spec.md#10-validation-gate-reproducible) into steps for the three device classes the owner named ([ADR-0020](decisions/0020-monitoring-analytics-and-owner-choices.md)). It uses **two kinds of data**: the representative Bengaluru pilot data (real companies, few points), and the dense synthetic S/M/L datasets (thousands of points). Real data alone will not reach the clustering and texture limits. **Emulated runs (Playwright's phone profile) do not count towards this gate.**

## Before the day

| Item | Who | Status |
| --- | --- | --- |
| Device models, OS and browser versions recorded (one mid-range Android, one iPhone, one ordinary laptop) | Owner | Pending |
| A named gate owner, who signs the report | Owner | Pending |
| The network profile: Chrome "Fast 4G" (or an agreed custom profile) and a cold cache for first loads | Owner confirms | Proposal |
| A build of the current commit served on the local network, so phones can reach it: `npm run build` with `DEV_ROUTES=on`, then `npx wrangler dev --ip 0.0.0.0 --port 8788`, opened at `http://<laptop-ip>:8788` | Engineer | Ready |
| **Tooling gap 1:** the harness (`npm run gate`) drives the laptop's own Chrome. For Android it needs a mode that attaches to Chrome on the phone over USB (`adb forward tcp:9222 localabstract:chrome_devtools_remote`, then `chromium.connectOverCDP`). | Engineer | **Not built** (plan P2-09a) |
| **Tooling gap 2:** iOS Safari cannot be driven by Playwright. An in-page runner is needed: a dev page that runs the scenarios itself and shows the raw numbers to copy (frame times from `requestAnimationFrame`, hit checks from the debug hook). | Engineer | **Not built** (plan P2-09b) |

Until the gaps are built, the laptop can run the full harness, and the phones can run the **manual protocol** below. The manual protocol records observations, not numbers, so it cannot pass the gate's numeric thresholds by itself.

## Datasets

| Name | What | Why |
| --- | --- | --- |
| **Pilot** | The Bengaluru pilot companies, once imported locally (`data/pilot/bangalore/`), built with `npm run data` from the local database | What visitors will actually see: real addresses, real spread, real logos when they exist |
| **S** | 1,500 synthetic offices (the launch estimate), fixed seed | The launch-scale load |
| **M** | 5,000 synthetic offices | Clustering under load |
| **L** | 15,000 synthetic offices, with dense hotspots, 50 identical-coordinate groups, and a 30-company building | Headroom: the cluster, spider, and texture-atlas limits |

The synthetic datasets are labelled synthetic in the page and never leave the test build.

## Scenarios (map-spec §10)

For each device, in this order, on each dataset (Pilot first, then S, M, L):

1. **Cold load** under the network profile: time to the first drawn markers, and the JavaScript transferred (`tests/e2e/budgets.spec.ts` measures the bytes on the laptop).
2. **Rapid zoom:** 20 cycles z11 ↔ z17 over the densest area, 1.5 s each, interrupting mid-transition.
3. **Filtering during zoom:** Startup, then Startup + Seed, then MNC while scenario 2 runs; the counts in the toolbar, the map, and the list must agree.
4. **Pan** across the city at z14 for 10 s.
5. **Tap accuracy:** tap every stacked and spidered group in the co-location fixture (S/M/L), and 20 single logos (Pilot); every tap opens the right company.
6. **Long session memory:** mount and unmount the explorer 20 times, then use the map for 10 minutes; record the heap before and after.

## Measurements and thresholds (proposals until the gate owner confirms)

| Metric | Laptop (harness) | Android (harness once P2-09a exists; manual until then) | iPhone (in-page runner once P2-09b exists; manual until then) | Proposed pass |
| --- | --- | --- | --- | --- |
| Frame time during zoom | rAF timestamps (`tests/gate/`) | CDP trace over USB | in-page rAF log | p95 ≤ 18 ms desktop, ≤ 33 ms phone; ≤ 5% dropped frames |
| Filter latency | harness | harness | in-page | ≤ 1 s warm on S |
| Hit accuracy | harness (debug hook) | harness | in-page | 100% |
| Duplicate or stale markers | debug hook | debug hook | in-page | 0 |
| Memory after 20 mounts | CDP heap | CDP heap | Safari Web Inspector (Timelines, manual) | within 10% of baseline |
| Listener leak | CDP | CDP | not measurable on iOS; record as not measured | no growth |

## Manual protocol (until the tooling gaps close)

On each phone, for each dataset: run scenarios 2 to 5 by hand. Record for each, in a table: smooth / visible stutter / freeze, a screen recording (the phone's own recorder, 60 fps if available), and any wrong popup, duplicate marker, or blank tile. Note the device temperature and battery saver state. Attach the recordings to the report.

## Report

`docs/map-gate-report.md`, as map-spec §10 says, with:
- device models and versions, network profile, commit, dataset hashes (`map/fixtures/manifest.json`), and the pilot dataset's manifest;
- raw numbers per metric, device, and dataset;
- pass or fail per metric;
- the gate owner's sign-off.

If anything fails, do not switch to plain markers silently: record the metric, the options, and their effects, and ask for a decision in an ADR (map-spec §10, CLAUDE.md).
