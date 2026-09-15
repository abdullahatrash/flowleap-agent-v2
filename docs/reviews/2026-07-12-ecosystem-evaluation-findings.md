# Ecosystem evaluation findings — end-to-end, patent-professional lens

**Date:** 2026-07-12 · **Charter:** `docs/handoff/0001` §4 · **Evaluator:** fresh agent session
**Method:** two realistic recipe runs driven by Claude-harness subagents acting as
patent-professional users (prior-art + FTO), plus direct spot-checks of the tool skills,
the MCP-only stdio path, and the install/doctor plumbing. All against the live backend
(`api.flowleap.co`) with stored auth. CLI v0.3.4.

Artifacts (session scratchpad): `prior-art-deliverable.md`, `fto-deliverable.md`, and the
two verbatim friction logs `prior-art-friction.md`, `fto-friction.md`.

---

## Headline

**The content moat is sound; the data plumbing has a US-shaped hole.** Both deliverables
read like real patent work product, not coding-agent output — correct X/Y/A tagging,
one-row-per-family dedup, effective-date discipline (a 35 USC 102(a)(2) call on an
earlier-filed pending app), all-elements FTO reasoning, dependent-vs-independent claim
design-around analysis, jurisdiction-specific family risk, and a caught false-positive.
The founder's coding-agent-bias worry did **not** materialize in the reasoning layer.

Where the ecosystem falls down is the **data layer feeding that reasoning**: the tooling
cannot retrieve US claim or description full-text through any route, silently
under-reports patent families on its most convenient verbs, and reports a zero-hit search
as a raw backend error indistinguishable from an outage. These corrupt or block the core
deliverable for the US market — which is most of the market. Everything else is skill/CLI
hardening in the established `#149` measured-drift pattern.

---

## Deliverable quality (the actual charter question)

**Prior-art / novelty (wrist-worn bioimpedance hydration monitor):** attorney-grade. Feature
decomposition F1–F7; one-row-per-family table, X/Y/A tags, X-first; correctly identified the
novelty center of gravity as the *combination* F2+F3+F4+F5 and named the two white-space
features (humidity-derived sweat-rate compensation; per-user ML calibrated against logged
intake); flagged the earliest-priority pending app (Onda Vision, prio 2024-09) as likely
102(a)(2) art; NPL vs academic split handled correctly; recommended a CPC classification
sweep to catch older art the keyword search under-weighted. Honestly disclosed that US
references were assessed on **abstracts only** because claims were unavailable.

**FTO (smart bicycle helmet, US + DE):** outside-counsel-grade. All-elements analysis on
every live blocker; the crux FTO insight — every functional claim of the top EP blocker
(EP 3 261 474) depends on a structural "wing+cavity" battery-box claim, so the product
clears the whole patent by not using that housing — is exactly how a real FTO reasons.
Jurisdiction-aware family analysis (Lumos competitor family is US/WO/AU/CA/NZ only → **no**
German risk; Bosch has a DE member → German-side check). Caught that the most-feared Bosch
patent is a helmet-worn camera, **not** crash detection → cleared. Flagged the DE-validation
gap and the missing DPMA/*Gebrauchsmuster* search. No dev idiom anywhere.

**Verdict:** an attorney would accept both as first-pass work product with the stated
caveats. The caveats they carry are forced by tooling gaps, not analytical weakness.

---

## Findings, tiered

### T1 — Must fix before release (blocks or corrupts the core deliverable)

**F1. Claim & description full-text is unreachable for every office except EP/WO.**
`ops claims`/`ops description` and the tools-facade `get_claims`/`get_description` all proxy
EPO OPS, which 404s `CLIENT.InvalidCountryCode` for US publications — **and for DE-national
publications too** (the FTO run confirmed the same wall on the German side, so this is not a
US-only gap but a "non-EP/WO office" gap); USPTO ODP (`uspto grant`) returns prosecution
metadata with no claim text. EP/WO full-text works (verified control: EP 4 559 385 returned
26 claims). For a German-market FTO this means DE-national rights are as claim-opaque as US ones. Both recipes' Step 4 says "pull claims for the closest
hits" — but the closest hits are US publications in both runs, so **all-elements claim
mapping, the actual deliverable, is impossible for US references.** Both agents were forced
to abstracts + WO/PCT-family-member claims as a proxy (granted US claims can differ from
PCT-as-filed). US is the majority market. *This is the single most important finding and is
not currently tracked.* → **new issue (backend/CLI): a US claim-text route** (Patent Public
Search / PatentsView / bulk full-text), and until then recipes must state the limitation and
route US claim reads out-of-band.

**F2. Family under-reporting is systemic across `summary` and the tools facade (extends #153).**
`summary WO2026020018` reports "Family: 1"; `get_patent_family` (facade) returns 1 member;
`ops family` returns the full INPADOC set (18 members / 5 distinct publications, incl. 4 US
siblings). Same split on US 2026/0069159 (1 vs 4). This breaks **one-row-per-family dedup**
and, worse, **jurisdiction risk visibility** — an agent screening with `summary`/facade would
not see that a family has a DE member (exactly the Bosch-vs-Lumos distinction the FTO run
turned on). The convenient verbs are the wrong ones. → **extend #153** to cover `summary` and
`get_patent_family`, root-cause the parse divergence from `ops family`.

**F3. A zero-hit EPO search surfaces as a raw 404 backend error (extends #154).**
CLI: exit 5 + raw OPS XML (`SERVER.EntityNotFound`); MCP: `isError:true` wrapping the same
XML. An agent cannot distinguish "no prior art exists" (a substantive novelty signal) from
"backend is down." The USPTO leg already does this correctly (exit 0 + "No results found" +
an actionable note to broaden). The FTO run hit this on features F3/F4 and only recognized it
as query over-narrowing, not failure, because the skill tips happened to warn. → **extend
#154**: translate OPS `EntityNotFound` to an empty-result contract at the backend facade,
mirroring the USPTO leg.

**F4. Stale pre-manifest skill copies remain invisible/mislabeled (#150 residual).**
The founder machine carried 21 July-4 skill copies predating the content-hash manifest;
`doctor` reported `stale: []` and `skills install` labeled them "locally-modified" (false —
they are untouched old installs). This is exactly the population #150 was meant to catch.
Fixed locally via `--force`. → **track under #150 app/CLI slice**: classify unrecorded copies
as "untracked (unknown origin)" distinctly from "locally modified," and hash old copies
against all released versions to auto-recognize unmodified stale installs.

### T2 — Should fix (measured drift → skill/CLI hardening, the #149 pattern)

**F5. `academic` (Semantic Scholar/arXiv) is near-useless for applied biomedical-device art;
`npl` (OpenAlex) delivered.** Two keyword strings both returned off-topic arXiv preprints;
`npl` returned 10/10 on-point reviews with citation counts. The prior-art recipe runs the two
as equals in Step 3. → recipe/skill routing note: for medical-device/applied literature prefer
`npl`; `academic` skews to CS/physics preprints.

**F6. Inconsistent JSON output shapes across sibling commands, and a skill's documented jq
path is wrong.** `patent search`/`uspto search`/`academic search` return bare top-level
arrays; `npl` returns `{results,total,…}`; `ops *` return objects. The `flowleap-uspto` skill's
example path `.patentFileWrapperDataBag[0].applicationMetaData` does not match the CLI's actual
record shape (app number sits at record top level; metadata nested under `.applicationMetaData`)
and returns null. Cost ~2 turns of `jq keys` probing per run. → fix the skill's jq examples;
consider a consistent envelope across search verbs.

**F7. `patent search` vs `legal search` flag whiplash (confirms #154).** `patent search`
*requires* `--query` and rejects a positional; `legal search` *requires* a positional and
rejects `--query`. Same repo, opposite contracts. → the #154 "positional AND --query on all
search verbs" fix should cover `legal search` too.

**F8. `build-query` leads with `ic=`/`cpc=` classification filters that over-narrow to 404.**
Both runs had suggested `ic=` primary queries (F21V, A61B) return zero hits. The tips warn, but
a *broad-focus* query should not front-load a classification AND-term. → tune the build-query
prompt so classification is offered as a narrowing option, not baked into the broad variant.

**F9. Search enrichment degrades with result volume (backend parsing).** `patent search --json`
returned null title/abstract/applicants for 3/10 hits on `ta=helmet AND ta=light`, 20/50 at
`--limit 50`, and MCP `search_patents` returned all-null biblio for a query the CLI fully
enriched at low limits. Agents may silently drop null-title hits. → root-cause the enrichment
parser; it should not partially fail by row.

**F10. MCP `search_patents` schema is anti-agent.** All five params (`query, provider, range,
limit, offset`) are `required` even though all but `query` are defaulted; `limit`/`offset` are
documented "uspto only" yet required for `epo_ops`; there is no enrichment toggle. → mark only
`query` required; document provider-specific params as optional.

**F11. `legal search --jurisdiction` enum is office codes, not jurisdictions.** Accepts
`uspto/epo/eu/wipo/all`; rejects `US`/`EP` — the terms a practitioner writes. → accept
jurisdiction aliases (US→uspto, EP→epo).

**F12. `doctor` reports the wrong latest CLI version.** Showed `latestVersion: 0.3.1` while npm
`latest` is 0.3.4 (`updateAvailable:false` was accidentally right). `recorded: 1` also
undercounts installed skills. → fix the version source and the recorded-count query.

**F13. Tools-facade arg passing is undiscoverable.** `tools run get_claims` wants `KEY=VALUE`
(not `--arg`) and `patent_number` (not the `docId` the `ops` CLI uses). Two failed calls before
success. → accept `docId` as an alias and document arg syntax in the facade help.

**F13a. EP legal-status cannot resolve per-country validation/maintenance.** For EP 3 261 474
(the top FTO blocker) the legal-status feed showed a mix of "lapsed in a contracting state"
and "annual fee paid 2025" events but never *which* states — so the FTO run could not confirm
German (DE) validation from the CLI at all, and had to defer to a DPMA national-register check.
For any EP-market FTO, "is this EP patent still in force in *my* target country" is the decisive
question, and the tool cannot answer it. → surface per-designated-state status where OPS/register
data allows, or explicitly route the agent to the national register with the states in hand.

### T3 — Polish / watchlist

- **F14.** USPTO `build-query` is necessarily blunt (`helmet* AND cpc:A42B*`) because ODP has no
  full-text index; correct, but the skill should say so and tell the agent to treat USPTO as a
  broad net and route precision through EPO CQL (which covers US docs bibliographically).
- **F15.** EPO results carry no relevance score; the recipe says deep-dive "top 5 by rank" but
  rank == API return order, and the order skews newest-first (top hits 2025–26). Agents must
  consciously widen for older foundational art. → clarify recipe language; verify OPS sort default.
- **F16.** Legal RAG returns TOC/heading-run chunks as top hits (query "doctrine of equivalents
  all elements rule" → §2123 heading list, not §2186). → drop TOC-run chunks at ingestion.
- **F17.** `get_family` is not a tool name (it is `get_patent_family`); an agent guessed and got
  `UNKNOWN_TOOL`. Minor naming discoverability.

---

## Release-gate impact (`docs/handoff/0001` §6)

- Gate 1 (#149 / #150-CLI / #151 merged, plugins re-synced, CLI released): **effectively done** —
  merged as flowleap-cli #26/#27, plugins synced to v0.3.4, website registry at 0.3.4. The issues
  are still open in the tracker but the work shipped.
- Gate 3 (evaluation charter run, must-fix findings applied, second pass clean): **this report is
  the first pass.** F1–F4 are the must-fix set; F1 (US claim text) is new and the most consequential.
  A second pass should re-run the FTO recipe once a US claim route exists, since that run's US
  all-elements analysis is currently proxy-based.

## Recommended issue actions

| Finding | Action |
|---|---|
| F1 US claim text | **new issue** [backend+cli+skills] — highest priority |
| F2 family under-report | extend **#153** (add `summary` + `get_patent_family`) |
| F3 zero-hit 404 | extend **#154** (empty-result contract for EPO leg) |
| F4 stale copies | fold into **#150** app/CLI slice |
| F5–F8 skill drift | **new issue** [cli/skills] — measured-drift batch, #149 pattern |
| F9 enrichment nulls | **new issue** [backend] |
| F10–F13 ergonomics | fold into **#154** ergonomics or a small [cli] batch |
| F13a EP per-country validation | **new issue** [backend] — decisive for EP-market FTO |
| F14–F17 polish | post-release backlog |
