---
name: pct-vs-ep-routing
description: Explains where filing errors surface and when — WIPO's ePCT validates a PCT application's form fields, priority claims, designated states, and fee calculation while the receiving office's own checks stay thin, whereas a direct European (EP) filing gets full EPO formalities and fee validation — plus the route-choice trade-offs (30-month deferral, cost timing, single-filing breadth vs direct-EP speed). Use when the user is deciding between a PCT/international application and a direct EP filing, asks about ePCT vs EPO or receiving-office validation, where PCT errors get caught, the 30-month delay, or which filing route to take. For readiness checks on either route use pre-filing-checklist.
user-invocable: true
---

# PCT vs Direct-EP Routing Explainer

Two things the user usually conflates: (1) **where validation happens** on each route — which changes where and when a mistake surfaces — and (2) **which route to choose**. Cover both.

Route facts, date-stamped with the "official rules govern" caveat, live in [references/routing-notes.md](references/routing-notes.md). For the statutory/procedural basis, use `search_legal`; do not fetch live fee amounts.

## Part 1 — Where validation happens (so where errors surface)
- **PCT via ePCT** — WIPO's platform validates the **form fields, priority claims, designated states, and fee calculation**. The **receiving office's own checks are thin**, so on the PCT route most catchable errors are caught **up-front by WIPO**, and the receiving office adds little. Practical consequence: a defect ePCT does not catch may not resurface until national/regional phase, far downstream.
- **Direct EP** — the EPO runs **full local validation**: formalities and fee checks happen at the EPO itself. Errors surface **early and locally**, at the office that will examine the case.

Say this plainly to the user: on PCT, lean on ePCT's validation and know the RO won't backstop it; on direct EP, expect the EPO to catch formalities and fees at filing.

## Part 2 — Route-choice factors
Walk the trade-offs (see the reference for the full table):
- **30-month deferral** — PCT buys time before committing to (and paying for) national/regional phases.
- **Cost timing** — PCT defers the big multi-country spend; direct EP pays sooner but skips PCT fees.
- **Breadth vs speed** — one PCT filing preserves rights across many states with a single act; a direct EP filing is faster to grant in Europe when Europe is the only target.

Recommend based on the user's targets and timeline rather than defaulting to one route.

The analysis-support-not-legal-advice note is emitted once per response by the system prompt — do not restate it per section.
