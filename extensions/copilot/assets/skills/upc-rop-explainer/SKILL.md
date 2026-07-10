---
name: upc-rop-explainer
description: Translates Unified Patent Court Rules of Procedure citations into plain language with the typical time windows each involves — e.g. RoP 5 opt-out, RoP 126 revocation, RoP 150/151 damages, RoP 192/199/200 provisional measures and evidence preservation, RoP 206 orders without hearing, RoP 264 interim conference, RoP 333 review of case-management orders, and the RoP 221–228 appeals cluster — plus the written/interim/oral/deliberation case lifecycle. It describes typical windows only and never computes party-specific deadlines. Use when the user cites or asks about a UPC Rule of Procedure number, what a RoP rule means, the typical timing of a UPC procedural step, or the phases of a UPC case. It does not calculate deadlines — recommend counsel/court confirmation. For which division and language hears the case use upc-division-router; for opt-out mechanics use upc-opt-out-actions.
user-invocable: true
---

# UPC Rules of Procedure Explainer

Turn a Rules of Procedure citation into plain language: what the rule does, where it sits in the case lifecycle, and the TYPICAL window it involves. This skill explains and describes; it does not calculate.

The rule-by-rule table and lifecycle model, date-stamped with the "official rules govern" caveat, live in [references/rop-notes.md](references/rop-notes.md).

## Hard boundary: describe windows, never compute deadlines
State typical windows as ranges the rule contemplates ("the defence to a revocation action is typically due within a set period of service"). **Never compute a party-specific deadline** — no date arithmetic, no "your deadline is X". There is no deadline calculator in scope. Every time a user asks "when is my deadline", say the window the rule describes and direct them to confirm the exact date with counsel and the court, because service dates, extensions, and case-management orders move it.

## The case lifecycle (the CMS's six-phase model)
UPC first-instance proceedings run through: **written procedure → interim procedure → oral procedure → deliberation**, with the interim conference (RoP 264) inside the interim phase and the decision issuing after deliberation. Place any rule the user cites into this lifecycle so the timing has context.

## The rules this skill is seeded with
Cover these in plain language with their typical windows (see the reference for the table): RoP 5 (opt-out), RoP 80 (costs/case management), RoP 126 (revocation actions), RoP 150/151 (damages proceedings), RoP 192/199/200 (provisional measures — evidence preservation and inspection), RoP 206 (order without hearing / ex parte), RoP 221–228 (appeals cluster), RoP 223, RoP 234, RoP 245, RoP 264 (interim conference), RoP 320, RoP 333 (review of case-management orders), RoP 354.4, RoP 356. For any rule not listed, explain it from its plain text and mark the window as "confirm against the current Rules of Procedure".

## Output
For each cited rule: (1) plain-language purpose; (2) its place in the lifecycle; (3) the typical window it contemplates, described not computed; (4) a reminder that the exact deadline must be confirmed with counsel and the court. The analysis-support-not-legal-advice note is emitted once per response by the system prompt — do not restate it per rule.
