# ADR-0023: Company classification definitions

- **Status:** Accepted (owner baseline, 6 Oct 2026)
- **Date:** 2026-10-06
- **Related tasks / decisions:** adds to [ADR-0016](0016-launch-sequence-and-data-policy.md) (the "Product" definition) and [ADR-0017](0017-company-status-separate-from-stage.md). Used by [docs/curation-guide.md](../curation-guide.md).

## Context
ADR-0016 defined "Product". The curation guide had proposed wording for "Startup" and "MNC", which the owner replaced with a baseline.

## Decision
- **Startup:** "A company founded to develop and scale a repeatable business model under substantial uncertainty. Apply this classification using documented evidence; funding stage alone does not determine it."
- **MNC:** "A company with established business operations in more than one country. Overseas customers alone do not qualify it."
- **Product** (unchanged, ADR-0016): "A company that develops and sells its own repeatable software or technology product. Companies may also offer services."
- Company type, funding stage, and ownership status stay separate, and none is inferred from another. The type tags overlap.

## Consequences
- The tags stay a curator's judgement, backed by evidence (ADR-0021). The database does not test the definitions; it records the evidence for the tags.

## Sources (with date checked)
- Owner instructions, 6 Oct 2026.
