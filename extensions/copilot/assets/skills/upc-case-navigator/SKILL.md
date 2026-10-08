---
name: upc-case-navigator
description: Case Navigation for a UPC Case — what each side can file next, under which Rule of Procedure, in which period, from which trigger event, given the case type and the last event. Use when the user asks what to file next in a UPC infringement, revocation, non-infringement, evidence, provisional-measures, protective-letter, appeal or EPO-decision case, which side files it, or how long they have. Gives the rule, the period and the trigger, never a calendar deadline date. For preparing the chosen filing use upc-filing-prep; for what a rule means use upc-rop-explainer.
user-invocable: true
---

# UPC Case Navigation

Answer "what can be filed next in this UPC Case, by which side, under which rule" from the case's last event. Give the rule, the period and the trigger event. **Never compute or state a calendar deadline date**, even when the user gives the date of the event: the representative computes and dockets the date.

The map of next filings is [next-filings.md](../upc-filing-prep/references/next-filings.md). The detail for each case type is in its family file: [infringement.md](../upc-filing-prep/references/infringement.md), [revocation.md](../upc-filing-prep/references/revocation.md), [applications-and-other-filings.md](../upc-filing-prep/references/applications-and-other-filings.md), [evidence-and-provisional-measures.md](../upc-filing-prep/references/evidence-and-provisional-measures.md), [protective-letters.md](../upc-filing-prep/references/protective-letters.md), [appeal.md](../upc-filing-prep/references/appeal.md), [action-against-epo-decisions.md](../upc-filing-prep/references/action-against-epo-decisions.md). The court fees are in [fees-2026.md](../upc-filing-prep/references/fees-2026.md).

## Step 1 — Get the facts
You need three facts: **our side** (claimant, defendant, appellant, respondent, applicant, third party), the **case type** (the Initial Filing: Statement of claim, Statement for revocation, appeal, and so on) and the **last event** (for example service of the Statement of defence). If a fact is missing and the answer depends on it, ask for it. If the question names one event and one side, answer it; do not ask. Use a date the user gives only to identify the trigger event, never to compute a date.

## Step 2 — Read the map and the family file
Read `next-filings.md`. Find the section of the case type and every row whose trigger is the last event. Then read the family file of that case type for the conditions of each filing (content, preconditions, what can be included). For an appeal, use the table "What can be appealed" in `appeal.md` and give each route that applies, with all of its options.

## Step 3 — List each possible next filing
Give one row per filing, in a table: **next filing | side that files it | rule | period | trigger event**, and a **fee** column when the user asks for the fee. Give one row per route: when a filing has two routes (for example RoP 220.2: with the final-decision appeal, or with leave), give a row for each. Cite the rule with its exact number (for example RoP 19.1, RoP 224.1(b)), and also the rule that opens or limits the route when the reference gives one (for example RoP 21.1 for an order on a Preliminary objection). State the period exactly as the reference gives it (for example "1 month from service of the Statement of claim"). Mark the filings that our side files. Include the rows from "Events in any UPC Case" only when they apply to the user's event. Add the reference rules that change how the period runs: periods start the day after the event and service is receipt (RoP 300(a)); a period ending on a non-working day moves to the next working day (RoP 301); an order of the Court can set another period (RoP 9). If the reference marks a period as not verified, say so. In the fee column, give the amount and its rule from `fees-2026.md` only, for every row.

## Step 4 — Say when the event opens no time limit
If the last event is one of the "Events that open no time limit" in `next-filings.md` (for example lodging a filing before it is served, the closure of the written procedure, a summons), say that it starts no RoP period, and ask for the service date of the document that does.

## Step 5 — Point to the next skill
For the filing the user chooses, point to **upc-filing-prep** (content, attachments, fee, signing). For what a rule means or how the Court applies it, point to **upc-rop-explainer**. Never give a calendar date. The analysis-support-not-legal-advice note is emitted once per response by the system prompt — do not restate it per section.
