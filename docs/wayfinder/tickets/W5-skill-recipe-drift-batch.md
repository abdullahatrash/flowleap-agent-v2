---
id: W5
title: Skill & recipe drift batch (academic routing, jq paths, build-query, rank language)
type: task
status: open
assignee:
blocked-by: []
---

## Question

Apply the measured-drift skill/recipe edits from the evaluation, at the canonical `flowleap-cli`,
then resync to `flowleap-plugins` (the established review→fix→resync loop).

Batch (findings F5, F6, F8, F14, F15, F16):
- **F5** — prior-art recipe treats `academic` (arXiv/SemScholar) and `npl` (OpenAlex) as equals,
  but `academic` returned off-topic preprints for applied biomedical art while `npl` delivered
  10/10. Add routing guidance: prefer `npl` for medical-device/applied literature.
- **F6** — the `flowleap-uspto` skill's documented jq path
  `.patentFileWrapperDataBag[0].applicationMetaData` does not match the CLI's actual record shape
  (app number is top-level; metadata nested under `.applicationMetaData`). Fix the examples.
- **F8** — `build-query`'s broad variant front-loads `ic=`/`cpc=` classification AND-terms that
  over-narrow to zero (both runs hit F21V/A61B 404s). Offer classification as a narrowing option,
  not baked into the broad query.
- **F14** — say explicitly that USPTO `build-query` is a broad net (ODP has no full-text index) and
  route precision through EPO CQL.
- **F15** — clarify recipe language: EPO results carry no relevance score, so "top 5 by rank" ==
  API return order (which skews newest-first); tell the agent to widen for older foundational art.
- **F16** — legal RAG returns TOC/heading-run chunks as top hits (drop TOC runs at ingestion — this
  one is a backend/ingestion fix, not a skill edit; split out if it doesn't belong in the skill batch).

### Definition of done
Edits merged at canonical `flowleap-cli`, goldens regenerated, `sync.json` bumped and
`flowleap-plugins` re-synced (drift check green). Each rule stated once at its owner skill (no
cross-recipe duplication — the craft rule).
