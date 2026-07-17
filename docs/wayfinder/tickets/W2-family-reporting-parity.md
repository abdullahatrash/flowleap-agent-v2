---
id: W2
title: Make summary and get_patent_family match ops family (INPADOC parity)
type: task
status: open
assignee:
blocked-by: []
---

## Question

Why do `summary` and the facade `get_patent_family` under-report a patent family (1 member)
where `ops family` returns the full INPADOC set, and what is the fix?

Verified (finding F2): `summary WO2026020018` → "Family: 1"; `get_patent_family` (facade) → 1
member; `ops family` → 18 members / 5 distinct publications incl. 4 US siblings. Same split on
`US20260069159` (1 vs 4). This breaks **one-row-per-family dedup** and — worse — hides
cross-jurisdiction risk (an agent screening with the convenient verbs misses that a family has
a DE member; this is the exact Lumos-vs-Bosch distinction the FTO run turned on).

### Definition of done
`summary` and `get_patent_family` return the same INPADOC family `ops family` does, for the two
repro docs and a handful of others. Root-cause the parse divergence (the convenient verbs read
a different/narrower field than the direct OPS family call). Add a regression assertion that the
three routes agree. Surface (backend and/or CLI) named in the resolution.
