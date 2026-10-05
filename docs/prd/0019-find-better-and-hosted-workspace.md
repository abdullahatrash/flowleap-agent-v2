# PRD 0019 — Find Better, Search Statement, Hosted Workspace

**Status:** ACTIVE 2026-10-05 — ADR 0010 + ADR 0011 accepted (#500); issues: F1 cli#125, F2 cli#126, F2(app) #502, F3 #503, F4 #504, F5 #505, H1 #506, H2 #507, H3 backend#547, H4 website#372, H5 #508, R1 #509
**Date:** 2026-10-05
**Base:** main after v0.5.0 (published 2026-10-05 09:36Z) and #500 (`7f93ec2cd56`)
**Decides:** nothing new — executes ADR 0010 (Find Better) and ADR 0011 (Hosted Workspace).
**Glossary:** `CONTEXT.md` → Find Better, Examiner Baseline, Search Statement, Hosted Workspace.
**Evidence:** grilling session 2026-10-05 (memory `find-better-and-hosted-workspace-adrs`); the
invalidity answer key for EP2110298B1 (memory `invalidity-chart-grounding`); the 2000 World
Patent Information article that motivates both ideas (`~/Downloads/elsevier article paul.pdf`,
not in the repo).

## Why

An experienced EPO patent professional proposed two modules in a private note. One, **Find
Better**, starts from a granted patent, collects what every office cited across the family, and
searches beyond it. The other, **Conceptualise This**, turns claims into an editable,
concept-based search statement with a one-click hand-off to Espacenet. Both are the practice his
article described in 2000; the app already carries most of the parts. The founder wants to show
him the ideas running before answering him, and the evaluator has no AI vendor account and may
not install anything. That makes a browser-reachable, FlowLeap-paid instance a prerequisite: the
**Hosted Workspace** (ADR 0011).

Three phases. **F** builds Find Better and the Search Statement. **H** builds the first Hosted
Workspace. **R** releases v0.6.0. F and H run in parallel; the evaluator acceptance (H5) needs F
merged on main, not released.

## Phase F — Find Better and the Search Statement

### F1 — `examiner-baseline` verb (flowleap-cli)
`flowleap patent examiner-baseline <publication> [--json]`. Walk the family (`ops family`), read
each member's biblio (`ops biblio`) and take its `references-cited`: `citedBy`, `category`,
`relevantClaims`, `phase`, `npl`. For US members add the USPTO enriched citations keyed on the
application number (`citation search`). Dedupe cited documents by family. Print one matrix:
rows = cited documents (family-represented), columns = offices that examined a member, cell =
category and cited claims, plus `applicant` where only the applicant cited it. A member whose
office returns no citation block is a **gap row**, printed as "no citation record from <office>",
never as "nothing cited". `--json` is the shape the skill and the writer read. Guardrail: the
verb never calls a model; counts are the offices' counts. Acceptance: EP2110298B1 prints the
five A3 examiner citations (EP1602570 X claim 13; US4964287, US5135330, US2007052285, US4763957
X) in the EP column and matches Espacenet's "cited documents" for every member; one US-origin
family with an EP member shows both columns.

### F2 — Find Better skill (flowleap-cli skills → vendored to both app roots)
`recipe-find-better` in `flowleap-cli/skills`, vendored to `src/vs/sessions/skills` and adapted
in `extensions/copilot/assets/skills` (the typed-tool surface, same content intent). Steps: run
the Baseline (F1 verb, or the typed citation tools reading the same JSON shape); decompose each
independent claim into elements; the **three mandatory tracks** — backward citations two hops
from every X/Y reference, inventor and NPL-author networks (`search_academic` by author,
`patstat_applicant`/`patstat_neighborhood` where the inventor resolves), classification
co-occurrence of the target and its key citations combined with the claim's Discriminating
Terms; every track logs its queries and counts, empty included, in the working record; score the
examiner's best art and the found art on the same element rows; save with the F3 template.
`recipe-invalidity-analysis` Phase 1.4 ("art of record") becomes "run the Examiner Baseline".
Guardrail: SKILL.md stays about five steps with reference files (founder rule); no invalidity
conclusions in a Find Better report. Bump the CLI skills pin in all three places (manifest
`ref`, `refDisplayName`, the drift workflow's checkout ref).

### F3 — `find-better-report` template (extensions/copilot, writePatentResults)
Structured save only (`coverage` required, like `prior-art-report`). Per independent claim: the
element rows with two anchored columns, **examiner's best art** (from the Baseline) and **best
art found**, each rendered as "disclosed n of m" from validated rows; the Baseline matrix as a
section; the three tracks' logs as a section; "no better art found" rendered as a complete
result with the full Baseline. Quote validation, element map, second read, evidence companion
and working record exactly as `invalidity-claim-chart`. Guardrail: no numeric score typed by
the model reaches the page; the writer refuses a `better` row whose elements are not anchored.

### F4 — Search Statement block (extensions/copilot chat rendering + skills)
`claim-analysis` 3b and `prior-art` 1c/1d already produce concepts, synonyms and CPC. Render
them as one block: concept table, the Boolean statement in the target syntax (OPS/Espacenet CQL
first; USPTO Lucene when the user asks), a copy button, and an **Open in Espacenet** link
(`worldwide.espacenet.com/patent/search?q=<url-encoded statement>`). A visible warning when
the statement has no **Discriminating Term**. Editing is "ask the agent to change a concept" in
v1; the working record keeps every version that ran. Guardrail: no new webview; reuse the
markdown renderer and the link-pill path from the 1.139 port. AbS is not offered.

### F5 — Find Better acceptance (verify)
Three runs from a FRESH EMPTY workspace, editor chat on Sonnet 5 and one Agent Session: (a)
EP2110298B1 — Baseline equals the answer key, found art predates 2009-01-19, the ≥3-lobe
element stays un-anticipated; (b) a patent the founder picks where PTAB or an EPO opposition
relied on art not of record — Find Better must surface at least one of those references or
state in the track log where it looked; (c) a patent with no better art — the report renders
complete with "no better art found". Bar: zero fabricated references, zero quotes not found,
Baseline per member matches Espacenet. Record in `docs/reviews/`.

## Phase H — the first Hosted Workspace

### H1 — `reh-web` build and boot spike (build)
From main in a worktree: `npm run gulp vscode-reh-web-linux-x64-min` (or the name the gulpfile
exposes), package with the Linux server leg, run it in a Docker Ubuntu 24.04 container, open it
in a browser. Pass = the workbench loads, the Patent Agent extension activates on the server
extension host, a trial key is provisioned after FlowLeap sign-in, an Agent Session starts with
`ANTHROPIC_API_KEY` in the container env and answers once. Report what breaks against the PRD
0017 keep-outs; fix only what the spike needs. Output: `docs/reviews/<date>-reh-web-spike.md`
and the exact build command that worked.

### H2 — Hosted VM recipe (ops, scripts in agent-v2)
`scripts/hosted/install.sh` for a fresh Ubuntu VM: the H1 package, systemd unit with the API key
and spend-cap note in the environment file (0600), nginx with HTTPS (certbot) at
`<name>.app.flowleap.co`, WebSocket upgrade, and `auth_request` to the H3 route carrying the
Clerk session cookie. `scripts/hosted/teardown.sh` deletes everything. One VM per user, no
backend secrets on it. Documented in `docs/hosted/README.md` with the ten-minute checklist.

### H3 — Hosted authorize route + allowlist (flowleap-backend)
`GET /v1/hosted/authorize`: verifies the Clerk session, checks `HOSTED_ALLOWLIST` (Clerk user
ids, env), answers 204 or 401/403, and emits `hosted.workspace_opened` through the activation
telemetry contract (content-free). No persistence, no spawner.

### H4 — Data-handling page: hosted section (flowleap-website-v2)
One section on `/data-handling` stating what a Hosted Workspace holds on FlowLeap's server
(files, chat, keys in that instance's secret storage), that inference runs on FlowLeap's
provider account there, and that the instance is deleted on request. Founder writes the final
words; the agent supplies the structure and the facts from ADR 0011.

### H5 — Evaluator acceptance (founder + verify)
Create the evaluator's FlowLeap account and Pro entitlement, add him to the allowlist, provision
`<name>.app.flowleap.co` with H2, set the Anthropic spend cap, and run F5(a) once in his instance
from a browser on a machine that is not the founder's. Then hand over the link. After the
evaluation window: teardown, revoke the key. Observation notes go to `docs/reviews/`, no names.

## Phase R — release

### R1 — v0.6.0
CLI release with F1 and F2 skills; app pins bumped and re-vendored (F2); CHANGELOG: "Find
Better: post-grant prior-art discovery with an Examiner Baseline", "Search Statement with Open
in Espacenet"; H4 live before publish. Standard release pipeline; nothing hosted ships in the
desktop build.

## Explicit non-goals

- No spawner, no Pro-tier hosted entitlement, no multi-user box (ADR 0011 decision 4 defers it).
- No change to Remote Access scope; Phase B of PRD 0018 is neither started nor cancelled.
- No AbS integration; no CN/JP/KR full-text element mapping (abstracts and citations only).
- No model-rated "significance" score anywhere.
- No public credit, case study or release note naming the proposal's author without consent.

## Execution

- F1 → (F2 ∥ F3 ∥ F4) → F5. H1 → (H2 ∥ H3) → H4 → H5. R1 after F5 and H4; H5 may run from main.
- One PR per slice, based on main; agents in `../wt-<slice>` worktrees; never `git add -A`;
  CLI work in its own `wt-*` worktree of `flowleap-cli` (subagent worktrees fork the session
  repo).
- Skills: canonical in `flowleap-cli/skills`, vendored by `scripts/vendor-patent-skills.ts`,
  drift-checked; the assets copy is an `adaptation` entry in the manifest.
- Verification uses the `verify-flowleap-ide` skill for app claims and a fresh empty workspace
  for every acceptance run.

## Outcome

_Pending._
