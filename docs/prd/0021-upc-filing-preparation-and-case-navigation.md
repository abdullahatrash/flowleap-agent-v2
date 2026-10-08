# PRD 0021 — UPC Filing Preparation and Case Navigation

**Status:** DRAFT 2026-10-08 — spec #568 (ready-for-agent)
**Date:** 2026-10-08
**Base:** `origin/main` at `733e42f62f6` (after #563)
**Decides:** nothing new — executes ADR 0013.
**Glossary:** `CONTEXT.md` → UPC practice: UPC Case, UPC Filing, Initial Filing, Subsequent
Filing, Filing Preparation, Case Navigation.
**Evidence:** grilling session 2026-10-08; the private UPC knowledge base (local, not in the
repo; includes the official UPC fee table in force from 2026-01-01); PR #567 (corrected
`upc-rop-explainer`).

## Why

UPC representatives must know, for each UPC Filing, who may file it, where, in which language,
with which content, attachments and fee, and under which rule its time limit runs. The court's
CMS does not tell them: it computes no deadline and lets any party file any Subsequent Filing at
any time. The app has four small UPC skills (division, opt-out eligibility, opt-out request
types, RoP explainer), but nothing that prepares a filing or says what comes next in a case.

## Users and jobs

- **Filing Preparation** — "I must file X in case Y. What do I need?" Output: a checklist in chat
  (Item · PASS/FIX/N/A · What to do), then a go / not-ready verdict, in the shape of
  `pre-filing-checklist`. Stops at the court portal; never files.
- **Case Navigation** — "Here is my case and its last event. What can be filed next, by which
  side, under which rule?" The representative gives our side, the case type and the last event
  with its date. Output: the possible filings, each with rule, period and trigger event. Never a
  calendar date.
- **First steps** — "How do I start at the UPC?": representative registration and the first
  steps in the CMS. One short skill.

## Slices

### U1 — Reference files (law layer + form layer)

Under `extensions/copilot/assets/skills/upc-filing-prep/references/`, one file per family:
infringement (incl. counterclaims), revocation (incl. application to amend), provisional
measures and evidence (R.192/199/200/206), protective letters, appeal (incl. orders, cross-appeal,
suspensive effect), action against EPO decisions, applications and other filings (R.80, 126,
150/151, 245, 320, 356 …), plus `next-filings.md` (Initial → Subsequent Filing map with the side
that files, the rule, the period, the trigger) and `fees-2026.md` (official table, version, URL,
date stamp; pre-2026 actions → 2023 table).
Each file: who may file, preconditions, mandatory content, attachments (screen labels), signing,
fee, time-limit rule. ADR 0013 applies: no internal codes, no CMS defects, form limits named
beside the law.
**Done when:** every family has a file; every rule number and fee is checked against the official
RoP and fee-table PDFs and carries its source.

### U2 — `upc-filing-prep` skill

SKILL.md ≈ 5 steps: identify the filing → read its family file → send division and language to
`upc-division-router` → build the checklist → verdict. The description routes "prepare / what do
I need to file" questions and points to the other UPC skills. Opt-outs stay in the opt-out skills.

### U3 — `upc-case-navigator` skill

Asks for our side, case type, last event and date; reads `../upc-filing-prep/references/
next-filings.md`; lists the possible next filings with rule, period, trigger. Never a date.
Points to `upc-rop-explainer` for rule meaning.

### U4 — `upc-representative-start` skill

Registration (who may register, evidence, Registrar examination, deficiency, petition for
review, removal and re-entry), account and organisation set-up, roles (drafter, signer, payer,
representative). Law and screen facts only.

### U5 — Corrections to existing UPC skills (ship at once)

- `upc-opt-out-actions`: all proprietors must join, but the form accepts one — say both; removal
  requests go to a "pending removal" state first; the correction is labelled
  "Opt-out/withdrawal correction".
- `upc-opt-out-check`: registration of unitary effect withdraws an existing opt-out (R.5.9).
- `upc-division-router`: add the divisions added since the list was written (check the current
  official list).

### U6 — Evals

A new promptfoo suite, "skill-grounded": the provider loads the named skill folder (SKILL.md and
references) into the context the way the app does when a skill runs. Works before U7. Plus one
live acceptance run in a local build with the skills registered (`verify-flowleap-ide`) to prove
routing. Five scenarios, three repeats each (the trajectory gate is flaky at n=1):
1. Defendant in an infringement action, Statement of claim received: what next, by when?
2. Prepare a revocation action at the central division for an SME client.
3. Protective letter: fee, validity, extension.
4. Appeal against an order versus against a final decision.
5. New representative: how do I register?
Checks: correct RoP rule, correct 2026 fee, no calendar date.

### U7 — Registration (release gate)

Add the three skills to `chatSkills` in `extensions/copilot/package.json` and to
`activationTelemetry.ts`. **Merges only after the practitioner approves U1–U4.** All other
slices merge to `main` when green; unregistered skills do not reach users.

## Order

U1 → U2, U3, U4 (parallel) → U6 → practitioner review → U7. U5 runs at any time.

## Explicit non-goals

- No calendar-date computation (ADR 0013).
- No lookup of live UPC case data; the representative gives the facts.
- No saved checklist file or report template in v1.
- No CLI or plugin copies; the UPC skills stay app-only.
- No filing through the court portal.

## Open

- Practitioner for the legal review: not yet named.
- Founder confirms the right to use the source material (ADR 0013).
