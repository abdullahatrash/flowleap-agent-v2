---
name: pre-filing-checklist
description: Pre-flight readiness review the user runs BEFORE opening an official patent-filing portal — checks required application parts, the 12-month Paris priority and 30-month PCT national-phase windows, applicant/representative constraints, and the ST.26 sequence-listing trigger. Use when the user asks whether an application is ready to file, what is needed to file at the EPO or enter national phase, is about to submit to a filing portal, or mentions filing deadlines, priority claims, missing filing parts, divisional filings, or a pre-filing/readiness checklist. For fee reductions use fee-reduction-advisor; for claims-count surcharges use excess-claims-estimator; for choosing PCT vs direct EP use pct-vs-ep-routing.
user-invocable: true
---

# Pre-Filing Readiness Checklist

A plain-language pre-flight the user runs BEFORE touching an official portal. Walk every item, ask the user for anything unknown, and report each as PASS / FIX / N/A with the fix needed. Do not submit anything — this readiness check ends at the portal door.

Extracted rules (windows, formats, edge cases) with a date stamp and the "official schedules govern" caveat live in [references/filing-requirements.md](references/filing-requirements.md). When the user wants the statutory basis for a deadline or requirement, ground it with `search_legal` (or `legal_search_guide` to pick the right corpus) rather than asserting it from memory.

## 1. Required parts
- **Description** — required to secure a filing date.
- **Claims and abstract** — may follow after the filing date, but their absence triggers a deficiency workflow with its own deadline. Flag them as FIX-soon, not blockers.

## 2. Priority & deadline windows
Ask the user for the earliest priority date and the route, then check:
- **Fresh filing claiming priority** — must be within **12 months** of the earliest priority date (Paris Convention). Past it, the priority claim is lost (limited restoration may exist — send the user to counsel).
- **PCT national-phase entry** — must be within **30 months** of the priority date. Confirm the source PCT number is well-formed: `PCT/CCyyyy/nnnnnn` (CC = receiving-office country code).
- **Divisional filing** — requires the **parent application number**; confirm the parent is still pending.

## 3. Applicants & representative
- **At least one applicant** is required.
- A **lone applicant who is a US national** typically needs a **confirmed professional representative** before the EPO — flag this as a FIX before filing.
- **Only one applicant** may use a correspondence address different from the others; more than one divergent address is a deficiency.
- When ownership shares are stated, they **must sum to 100%**.

## 4. Sequence listing (ST.26) — attachment-triggered
The ST.26 sequence-listing requirement is triggered by **attaching a sequence listing**, NOT by claiming biotech subject matter. So a biotech application does not automatically demand one — but if disclosure includes sequences, the filer must **proactively** include a compliant ST.26 listing. Ask biotech/life-science filers directly whether sequences are disclosed, and remind them the obligation is theirs to raise.

## 5. Fees
Confirm the intended fee posture — one of: **already paid with proof**, **paid immediately at filing**, or **deferred**. This item only checks that a posture is chosen and any proof is ready; concrete amounts and reductions are out of scope here (see fee-reduction-advisor and excess-claims-estimator).

## Output
Summarise as a table: Item · Status (PASS/FIX/N/A) · What to fix. End with the go / not-ready call. The analysis-support-not-legal-advice note is already emitted once per response by the system prompt — do not restate it per item.
