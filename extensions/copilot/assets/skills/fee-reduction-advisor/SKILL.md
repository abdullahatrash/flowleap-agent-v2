---
name: fee-reduction-advisor
description: Interviews the filer about jurisdiction, applicant type, filing language, and inventor-is-applicant status, then explains the official-fee reductions they likely qualify for and the proof documents each requires. Use when the user asks about fee reductions or discounts, micro-entity or small-entity status, SME / natural-person / university / non-profit reductions, the EPC language-based reduction, filing more cheaply, or whether they qualify to pay less. For per-claim excess-claim surcharges use excess-claims-estimator; for filing-readiness use pre-filing-checklist.
user-invocable: true
---

# Fee-Reduction Eligibility Advisor

Reductions are not automatic and the rules differ radically by office — the EPO's own e-filing platform never centralised them, so each national office hand-rolled its own incompatible logic. So **interview first, advise second**, and always name the proof the applicant must attach.

Jurisdiction-by-jurisdiction rules, with a date stamp and the "percentages drift, verify the schedule" caveat, live in [references/fee-reductions.md](references/fee-reductions.md). To ground a specific legal basis (e.g. EPC Rule 6), use `search_legal`; do not fetch or invent current fee amounts.

## Step 1 — Interview (ask before advising)
Collect all four, via `vscode_askQuestions` when available:
1. **Jurisdiction / office** — EPO, USPTO, or a specific national office (its rule may be unique).
2. **Applicant type** — natural person, SME, university, non-profit/research org, or large entity.
3. **Language of filing** — and whether it is an official language of an EPC contracting state that is NOT an EPO official language (EN/FR/DE).
4. **Inventor-is-applicant status** — is every applicant also a named inventor?

Do not advise until jurisdiction and applicant type are known.

## Step 2 — Match likely reductions
Using the reference, map the answers to the reductions that plausibly apply. Examples of the shape (verify amounts against the current schedule):
- **EPC Rule 6 language reduction** — ~30% off filing/examination for SMEs, natural persons, universities and non-profits who file in a non-EPO official language of a contracting state and supply the translation.
- **USPTO micro-entity / small-entity** — large reductions on most fees (micro deeper than small); gated by income/filing-count and entity criteria that must be certified.
- **National-office quirks** — e.g. some offices give ~50% off filing+claims fees when every applicant is also an inventor; others give ~66% off filing/search gated by a reduced-fee country list and a required proof attachment.

## Step 3 — State proof + caveats
For each reduction you surface, name the **required proof/certification** (declaration, entity-status statement, translation, country-of-residence evidence, …) and warn that **percentages and eligibility criteria drift** and must be verified against the office's current fee schedule and rules before filing.

The analysis-support-not-legal-advice note is emitted once per response by the system prompt — do not repeat it per reduction.
