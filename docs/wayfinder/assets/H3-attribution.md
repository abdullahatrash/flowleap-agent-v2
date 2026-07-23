# H3 — Root-cause attribution: splitting the harness gap across layers

> Asset for ticket [Root-cause attribution](../tickets/H3-root-cause-attribution.md) (map
> 0002, harness-gap parity). Built 2026-07-17 by walking every main-window failure in the
> [H1 repro corpus](H1-repro-corpus/) against the [H2 loop-behavior map](H2-loop-behavior-map.md),
> cross-checking each give-up in the raw transcripts and verifying the indicted mechanisms
> in fork source. Every attribution row cites a transcript (task/condition, round, quoted
> line) or a `file:line`. Feeds the fix slices (tickets H5–H10) and the
> [trajectory-eval-gate design](../tickets/H4-trajectory-eval-gate-design.md).

## Headline

**The measurable, outage-independent gap is model-dominated, not loop-dominated.** On the
four clean (non-confounded) corpus tasks, swapping only the model (Sonnet 4 → Sonnet 5) on
the *identical* fork stack closed **both** of the two gaps and left Sonnet 5 with **zero**
clean-task losses. Every main-window give-up in the corpus was a **model choice narrated
after reading a tool result** — never a loop-forced turn death. The single most damaging
failure (R1) was the model wrongly believing it *had no web capability* and quitting, while
the same stack's stronger model used the web-fetch tool that was there all along.

**The H2 suspect ranking is partly refuted by the evidence** (details below): its #1
mechanical suspect — *transient model-fetch failure ends the main-window turn* — has **zero
instances** in 16 main-window sessions. What actually costs the main window are (in order):
model capability, a **missing web-fallback-on-exhaustion rule**, **citation forward/backward
mis-routing**, and **hint-less generic backend errors** — the last three being fork-side
affordance gaps that a strong model routes around and a weak model falls into.

---

## Model vs. stack split (with numbers)

The clean/confounded partition is the load-bearing move. Per H1's own caveat, EPO's live
*search* endpoint was intermittently 504-ing during the main-window run window, so **S1, S2,
R4 are search-dependent and confounded**; **R1, R3, S3, S4 are outage-independent** (direct
document lookups / analytics that don't hit the down endpoint). We attribute on the clean
four and treat the confounded three as corroborating-but-weak.

| | clean tasks (R1,R3,S3,S4) | confounded tasks (S1,S2,R4) |
|---|---|---|
| **main-usual (Sonnet 4) losses** | R1, S3 (2/4) | S2, R4 (2/3) |
| **main-claude5 (Sonnet 5) losses** | **0/4** | S1, S2, R4 (3/3) |
| **gaps closed by the model swap** | **2 of 2 (100%)** | 1 of 2 (R4→partial only) |

- **Clean-task gap = model.** Both clean losses (R1, S3) are wins for Sonnet 5 on the same
  tools. Sonnet 5 has no clean-task loss. So the reproducible, un-confounded gap is closed
  by model capability alone.
- **H1's "residual stack effect" is weaker than the tally framed it.** H1 reported Sonnet 5
  still losing S1/S2/R4 as a residual stack cost. All three are the *confounded* tasks, and
  the losses are explained by (a) the EPO outage forcing long retry grinds plus (b) the
  test driver's **25-minute wall-clock cap** (`conditions.md`) cutting those grinds off
  mid-work — **not** a demonstrated product-loop deficiency. S2-claude5's transcript ends
  mid-tool-call (`"Searching patents: ta=piezoresistive AND ta=bandage"`, last response
  part) and R4-claude5 timed out after six live-search 504s: both are cap cutoffs during a
  legitimate grind, not give-ups. The confounded tasks therefore **cannot** carry a
  same-model stack indictment.
- **Why fix the stack anyway.** The two clean gaps, though model-closable, expose real
  fork-side affordance gaps (below) that a stronger model happens to route around. The map's
  destination is a **same-model** win-or-tie, so the target is to raise the *weaker-model
  floor* — make the good trajectory less model-dependent. That is exactly what H5–H9 do.

---

## Attribution table

Layer legend: **M** = model capability, **P** = system prompt, **K** = skills, **T** = typed-tool
design / error shape, **L** = agent loop, **X** = corpus confound/artifact (outage, driver cap,
profile contamination). "Give-up class" per the ticket method: *forced* (loop hit a stop
condition), *invited* (error shape read as a dead end), *chosen* (model stopped though a
route/fallback was available).

| Task / condition | Outcome vs bench | Give-up class | Primary layer | Contributing layers | Evidence (transcript / source) | Confidence |
|---|---|---|---|---|---|---|
| **R1 / main-usual** (Sonnet 4) | LOSS | **chosen** | **M** | P, T | Round 12: *"since we don't have web search capabilities … Use commercial patent databases like Derwent / PatBase / Orbit."* The `fetch_webpage` tool **was** available (Sonnet 5 used it at R1/main-claude5 round 17). Loop ran 13 rounds and never hit a stop condition. | **High** (clean task, direct same-stack model contrast) |
| **R1 / main-claude5** (Sonnet 5) | WIN | — | — | — | Round 17: *"I found a direct link to the official USPTO grant XML"* → `fetch_webpage`; delivered claims. Proves the fallback route exists on the fork stack. | High |
| **R1 (both) — backend route** | — | invited | **T** | — | The flowleap route is genuinely dead for US claims: `enrich=claims` returns a single record that exceeds `PatentApiRequest: 50_000` and the whole item is **dropped**, so the model reads `patentFileWrapperDataBag: []` + a *"Refine your query"* note (round 1, round 9 results) that is useless for a single-record lookup. `patentResponseFormatter.ts:84,111`; overlaps map 0001 F1. | High |
| **S3 / main-usual** (Sonnet 4) | LOSS | **chosen** | **M** | T, K | Used `search_forward_citations` (who-cites-this) for a *cited-against* question → 0 hits on EP + US member (rounds 6–8). Correctly *diagnosed* the mismatch at round 9 (*"the user asked for prior art references cited AS novelty-destroying (X) AGAINST … not patents that cite this family"*) but never found `search_citations` keyed on the US **application** number; fell back to register/timeline and concluded *"No … X-category prior art references were found."* | **High** (clean task) |
| **S3 / main-claude5** (Sonnet 5) | WIN | — | — | — | Walked EP → US family (US2019376586A1) → `get_continuity` → app number **16473445** → `search_citations(applicationNumber:16473445, category:X)` → **4 X-citations** incl. US20060169553A1 (rounds 11–13). The exact route Sonnet 4 missed. | High |
| **R4 / main-usual** (Sonnet 4) | PARTIAL (2/3) | **chosen** | **X** (outage) | T, P | `patent_analytics_viz` (round 0) returned real counts — filing trend + top assignees delivered correctly (the *"5,156"* count is **genuine**, the year rows sum to 5,156; not fabricated). Only the *most-cited* leg needed live `search_patents`, which 504'd three times (rounds 1,3,4); model gave up that leg: *"backend connectivity issues preventing the forward citation analysis."* | **Low** (outage-dominated); T-hint gap is real |
| **R4 / main-claude5** (Sonnet 5) | TIMEOUT | **X** (cap) | **X** | T, P | Six consecutive live-search 504s (rounds 5–10), progressive query broadening (good reformulation), then hit the **25-min driver cap**. Also burned 4 rounds on a path typo (`"…Investigation /analysis"` trailing space → ENOENT, rounds 0–3) it *recovered* from. | Low |
| **S1 / main-claude5** (Sonnet 5) | PARTIAL (US-only) | **chosen** | **X** (contamination) | P | Round 0 read a **pre-existing** `layered-la-fe-si-magnetocaloric-prior-art-report.md` (profile contamination from prior runs); jurisdiction carousel default (round 1) was *"Refresh/verify existing workspace report (US + EP/WO)"*; delivered a US-centric refresh. EP/WO live search was down. | Low (confound + contamination) |
| **S2 / main-usual** (Sonnet 4) | STALL (cap cutoff) | **X** (cap) | **X** | P, T | Jurisdiction gate pause (part 2), EPO search *"timing out"* (part 9) → USPTO pivot → found Smith & Nephew candidates via disk-offload read (parts 12–17) → *"The response was truncated. Let me search academic…"* (part 28) → transcript ends mid-grind (no result object written). A legitimate multi-source grind cut off, not a give-up. | Low (outage-dominated) |
| **S2 / main-claude5** (Sonnet 5) | STALL (cap cutoff) | **X** (cap) | **X** | — | Ends mid-tool-call on a live search; gateway timeouts throughout. | Low |
| **R2, R3, S4 (all conditions)** | TIE / correct-null | n/a | — | — | R2 all three correct-null (no infinite retry); R3 all three summarized the 222 KB description via disk-offload paging; S4 all three completed the continuity chain. **No gap** — rules these mechanisms out. | High |

---

## What the evidence says about each H2 suspect

The H2 map ranked ten mechanical suspects by *predicted* likelihood. Confronted with the
transcripts, the ranking reorders substantially:

| H2 rank | Suspect | Verdict from corpus | Note |
|---|---|---|---|
| **#1** | Transient model-fetch failure ends the turn (auto-retry only in autopilot) | **REFUTED** | **Zero** instances across 16 sessions. No session ends on `"The model unexpectedly did not return a response"`, `maxToolCallsExceeded`, or a `Continue to iterate` card (grep = 0). Every give-up is a *narrated model choice* after a *tool* result. The code path (`toolCallingLoop.ts:682-699`) exists but never fired — because these tasks failed at the **tool** layer (backend 504, empty, truncation), and tool errors do not end turns. |
| **#2** | Dead-end zero-hit strings on `search_patents`/`search_academic` + no zero-result rule | **UNTESTED / masked** | The two flagship search tools mostly **504'd** rather than returning clean zeros (the outage), so the dead-end *string* never got to fire as the cause. Not exonerated — just not the demonstrated mechanism here. `searchPatentsTool.ts:107`, `searchAcademicTool.ts:99` still lack a broaden-on-empty nudge. |
| **#3** | Generic backend errors carry no recovery hint | **CONFIRMED (bounded effect)** | `patentBackendErrorRecoveryHint` returns `''` for generic `PatentBackendError` (`patentBackendClient.ts:137`), verified. R4/S2 show raw `504 Gateway Time-out` HTML and `502 … odpRequest.q?.trim is not a function` bodies with no next step. **But** the missing hint did **not** cause die-on-error — Sonnet 5 retried through six 504s anyway. Effect: no *transient-vs-permanent* steer, so the weak model gives up and the strong model wastes calls. |
| **#4** | Prompt co-endorses stop-and-disclose with retry | **CONFIRMED (real, cross-cutting)** | Every clean give-up ends in a hand-back offer: R1 *"Use commercial databases … Would you like me to?"*, S3 *"consult … qualified patent counsel"*, R4 *"attempt the citation analysis again once … restored?"*. The prompt's only persistence cue is the generic coding-base line; no patent-specific *exhaust-fallbacks-first* ladder. `patentAIPrompt.tsx`. |
| **#5** | Skill-pack mismatch across surfaces | **Not isolable here** | Real (bench ran the CLI pack, main ran the 25 panel skills) but the corpus can't separate skill wording from model; folded into the K contributions on R1/S3. |
| **#9** | Jurisdiction-gate pause | **CONFIRMED (minor)** | The gate is a hard precondition (*"Do NOT make any search tool calls until you receive the jurisdiction answer"*, `patentAIPrompt.tsx:174`) and fires on S1/S2 — a stall the headless harness never has. But its **default is "Both (comprehensive)"**, so it is *not* what narrowed S1 (that was the pre-existing-report carousel option + contamination). Divergence is real; blame for S1 is mostly the confound. |
| **New** | **Web-fallback not endorsed for route-exhaustion** | **CONFIRMED (highest leverage)** | Not in the H2 list. The prompt's `web_search` rule (branch L, `patentAIPrompt.tsx:193,284`) is scoped to *offices with no dedicated tool* (CN/JP/KR), **not** to *"backend route exists but has no data."* R1 is exactly the latter: Sonnet 4 concluded it had no web capability and quit. The always-available `fetch_webpage` built-in is never named in the prompt (only the model-conditional `web_search`, `patentAIPrompt.tsx:28`). This is the precise, fixable seam behind the biggest single failure. |
| **New** | **Single-record truncation drops the whole document** | **CONFIRMED** | The 50k `PatentApiRequest` budget drops the *entire* item when one record exceeds it, so full-text claims/description lookups return `[]` + a "refine your query" note that a single-ID lookup cannot act on. `patentResponseFormatter.ts`. |

**Ruled out (agreeing with H2):** turn-abort-on-tool-error (neither side; confirmed 0
loop deaths), core-harness truncation (marked/iteration-inviting; R3 tied), loop-level
history handling.

---

## Ranked fix list (sized into ticket-shaped slices)

Ordered by evidence strength × leverage. Each is one agent session. Tickets H5–H10 graduate
these into the tracker. Scope stays inside the fork (loop/prompt/tools/skills/error shapes);
no CLI-stack rebuild.

### 1. H5 — Prompt: persistence/escalation ladder + web-fallback-on-exhaustion + search-error rule
**Changes.** In `patentAIPrompt.tsx`: (a) add an explicit escalation ladder — *before* any
hand-back or "would you like me to retry?", the agent MUST have exhausted (i) query
reformulation, (ii) an alternate office/tool, (iii) the **web fallback**; (b) broaden the
web-fallback rule so it covers *backend-route-exhausted* (not just no-tool jurisdictions),
and name the always-available `fetch_webpage` built-in alongside `web_search`, with Google
Patents / freepatentsonline as verify-then-quote sources; (c) add a **search-error rule**
distinct from the zero-result rule (transient 5xx/gateway/timeout ⇒ retry/back off, don't
disclose a coverage limit); (d) demote the co-endorsed stop-and-disclose lines; (e) make the
jurisdiction gate default-comprehensive and non-blocking for clearly comprehensive requests.
**Surface.** `extensions/copilot/src/extension/prompts/node/agent/patentAIPrompt.tsx`.
**Expected effect.** Flips **R1** (web fallback for exhausted routes), raises the give-up
threshold on **S3/R4/S2**, removes the **S1** stall. Highest single-lever change.
**Confidence.** High (R1 is the cleanest case in the corpus).

### 2. H6 — Skills: adaptive failure branches + citation routing note
**Changes.** Add zero-result / search-error / web-fallback branches to the search recipe
skills (prior-art, FTO, invalidity, landscape, office-action) so skill guidance matches the
H5 prompt policy instead of prescribing only up-front breadth; add a forward-vs-backward
citation routing note. **Surface.** the 25 bundled panel skills under
`extensions/copilot/assets/skills` (and their Claude-session filter, `claudeSkills.ts`).
**Expected effect.** Reinforces R1/S3/R4 recovery on the skill surface; reduces model
dependence. **Confidence.** Medium (skills couldn't be isolated from model in the corpus,
but the absence of any failure branch is verified). **Blocked-by: H5** (skills echo the
prompt's policy — land the policy first).

### 3. H7 — Citation tool empty-result routing strings
**Changes.** Make the empty-result strings name the sibling tool and the key chain
explicitly: `search_forward_citations` zero → *"For prior art cited AGAINST this patent, use
`search_citations` with the US **application** number (resolve via `get_patent_family` →
`get_continuity`)"* and vice-versa. **Surface.**
`searchForwardCitationsTool.ts:143`, `searchCitationsTool.ts:155`.
**Expected effect.** Flips **S3** at the weaker model (the route Sonnet 4 never found).
**Confidence.** High (clean task; exact mechanism identified).

### 4. H8 — Transient backend-error shape + recovery hint
**Changes.** Map generic 5xx / gateway / timeout responses to a typed transient error whose
`patentBackendErrorRecoveryHint` returns an actionable *"the backend is temporarily
unavailable (transient) — wait and retry the same query, or try a different office
meanwhile"* instead of `''`; strip raw nginx HTML from the model-facing body. **Surface.**
`patentBackendClient.ts:118-138` (the empty generic branch at `:137`), `patentToolError.ts`.
**Expected effect.** Reduces give-up + wasted retries under transient outage (**R4/S2**, and
R1 round 2's 502). **Confidence.** Medium (evidence is outage-confounded, but the empty-hint
code gap is real and verified — H2 #3).

### 5. H9 — Single-record document truncation: offload instead of drop
**Changes.** For single-record document lookups (`enrich=claims`/`description`, `grants/{n}`),
stop dropping the whole item at the 50k budget; offload the oversized field to a disk path
(the `read_file`-at-`<path>` pattern the harness already uses >8KB) or paginate the field, so
full-text can actually reach the model. **Surface.**
`patentResponseFormatter.ts` (`ToolResponseBudgets.PatentApiRequest`, `dropArrayItemsToFit`).
**Expected effect.** Makes the flowleap route for **R1** viable without web fallback; reduces
truncation friction on S2. **Confidence.** High for the mechanism; **coordinate with map
0001 F1** (US-claims data availability is the other half — this ticket fixes the *shape*, not
the *coverage*).

### 6. H10 — Default/recommend the stronger model (real-world lever, not a same-model fix)
**Changes.** Make the recommended/default main-window model the stronger Claude tier
(Sonnet 5), matching what the agents window resolves to, or surface a first-run nudge.
**Surface.** model default/config + onboarding copy (BYOK model selection).
**Expected effect.** The **largest real-world quality win** — the model swap alone closed
2/2 clean-task gaps. **Caveat, stated plainly:** this does **not** close the map's
*same-model* destination gap; it changes which model the user runs. Track it because it is
the highest-leverage evidence-backed lever, but H5–H9 are what the same-model head-to-head
needs. **Confidence.** High (direct A/B in the corpus).

---

## What surprised me / contradicted the H2 ranking

1. **H2's #1 suspect (die-on-model-fetch) has zero corpus support.** The prime predicted
   "die-on-error" mechanism never fired; the loop skeleton is even more exonerated than H2
   concluded. Every give-up is a *chosen* narration, which moves the whole fix surface off
   the loop and onto the **prompt/skills/tool-strings**.
2. **The biggest single failure (R1) was a hallucinated tool inventory**, not any of H2's
   ten suspects — the model asserted it had no web capability while `fetch_webpage` sat
   unused. This promoted a *new* top item (web-fallback-on-exhaustion) above the entire H2
   list.
3. **S3 "deferral" was actually six citation calls and a correct self-diagnosis** ending in
   a wrong-tool dead end — not the "deferred the citation leg" the H1 tally recorded. The
   fix is tool-routing, not persistence.
4. **R4-usual's "5,156" was real data, not a fabrication**, and R4-usual delivered 2/3
   sub-answers — softening H1's "GAVE UP" read and de-weighting R4 as a stack indictment.
5. **H1's "residual stack effect" doesn't survive the confound + the 25-min driver cap.**
   All three residual losses are outage-and-cap artifacts; the honest same-model residual on
   clean tasks is **zero**. The stack fixes are justified as *floor-raising for the weaker
   model*, not as closing a demonstrated same-model loss.
