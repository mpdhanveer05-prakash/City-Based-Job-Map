# ADR-0020: Monitoring, analytics, JavaScript budget, basemap evaluation, admin MFA, and backups

- **Status:** Accepted (owner decisions, 6 Oct 2026)
- **Date:** 2026-10-06
- **Related tasks / decisions:** resolves D-07 (except geocoding), D-12 (provisionally), D-06 (device classes), and D-08 (domain). Starts the D-11 evaluation. P2-09, P9-03, P9-10 to P9-15.

## Decision
1. **Errors and traffic (D-07).** Sentry for errors and Cloudflare Web Analytics for basic traffic. We keep aggregate click counts only and collect no personal identifiers unless a documented need arises. Sentry is configured without IP addresses or default PII, and the CSP (ADR-0014) is extended for the Sentry ingest host and the Cloudflare analytics beacon. The privacy notice states both.
2. **JavaScript budget (D-12).** MapLibre stays. A target of **650 KB gzipped** for the explorer is provisionally accepted, and app code keeps being profiled and reduced. The city-selection page has its own small budget.
3. **Map gate devices (D-06).** A real mid-range Android phone, an iPhone, and an ordinary laptop. The scenarios cover cold load, rapid zoom, filtering, dense markers, tap accuracy, and memory over an extended session. The exact device models, network profile, and gate owner are recorded when the run happens.
4. **Basemap (D-11).** Prototype Protomaps PMTiles on Cloudflare R2 now and compare it against Geoapify on visual quality, performance, operating cost, and reliability. The choice comes from that comparison.
5. **Admin access.** Public sign-ups are off, admins are created by hand, permissions are enforced in the database and functions, and **MFA is required**: admin write policies check `aal2`.
6. **Backups.** Off-site backups are automated, stored assets (logos) are backed up separately, and a restore drill happens before launch.
7. **Domain (D-08).** The product domain is **officemap.tech** (owned by the owner). Pointing DNS at the production Worker is a production deploy and follows the release gates.

## Consequences
- New tasks P9-10 to P9-15 in plan.md.

## Sources (with date checked)
- Owner instructions, 6 Oct 2026.
