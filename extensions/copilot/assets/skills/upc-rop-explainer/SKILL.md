---
name: upc-rop-explainer
description: Plain-language reading of a Unified Patent Court Rule of Procedure and the typical window it involves, plus the written, interim, oral and deliberation phases. Never computes party-specific deadlines. Use when the user cites a RoP number, asks what a rule means, or asks about the timing or phases of a UPC case. For division and language use upc-division-router; for opt-out mechanics use upc-opt-out-actions.
user-invocable: true
---

# UPC Rules of Procedure Explainer

Turn a Rules of Procedure citation into plain language: what the rule does, where it sits in the case lifecycle, and the TYPICAL window it involves. This skill explains and describes; it does not calculate.

The rule-by-rule table and lifecycle model, date-stamped with the "official rules govern" caveat, live in [references/rop-notes.md](references/rop-notes.md).

## Hard boundary: describe windows, never compute deadlines
State typical windows as ranges the rule contemplates ("the defence to a revocation action is typically due within a set period of service"). **Never compute a party-specific deadline** — no date arithmetic, no "your deadline is X". There is no deadline calculator in scope. Every time a user asks "when is my deadline", say the window the rule describes and direct them to confirm the exact date with counsel and the court, because service dates, extensions, and case-management orders move it.

## The case lifecycle (RoP 10)
UPC first-instance proceedings run through the RoP 10 stages: **written procedure → interim procedure → oral procedure**, then the panel deliberates and gives the decision on the merits (RoP 118). The interim procedure may include an interim conference (RoP 101–106). Separate procedures for the determination of damages (RoP 125 ff.) and for cost decisions (RoP 150 ff.) can follow. Place any rule the user cites into this lifecycle so the timing has context.

## The rules this skill is seeded with
Cover these in plain language with their typical windows (see the reference for the table): RoP 5 (opt-out and its withdrawal), RoP 9.3–9.4 (extending or shortening periods), RoP 23 / 49 (defence periods), RoP 80 (compensation for a licence of right), RoP 104–105 (interim conference), RoP 126 (application for the determination of damages), RoP 150/151 (cost decision proceedings), RoP 192–198 (preserving evidence, incl. without hearing the defendant), RoP 199 (order for inspection), RoP 200 (order to freeze assets), RoP 206 / 212 / 213 (provisional measures, incl. without hearing the defendant), RoP 220–235 (appeals cluster), RoP 223 (suspensive effect), RoP 224 (appeal periods), RoP 234 (challenge to rejection of an appeal as inadmissible), RoP 245 (rehearing), RoP 264 (opportunity to be heard), RoP 300–301 (calculation of periods), RoP 320 (re-establishment of rights), RoP 333 (review of case-management orders), RoP 354.4 (penalty payments), RoP 356 (setting aside a decision by default). For any rule not listed, explain it from its plain text and mark the window as "confirm against the current Rules of Procedure".

## Output
For each cited rule: (1) plain-language purpose; (2) its place in the lifecycle; (3) the typical window it contemplates, described not computed; (4) a reminder that the exact deadline must be confirmed with counsel and the court. The analysis-support-not-legal-advice note is emitted once per response by the system prompt — do not restate it per rule.
