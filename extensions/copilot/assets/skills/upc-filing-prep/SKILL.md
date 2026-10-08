---
name: upc-filing-prep
description: Prepare one Unified Patent Court filing before the representative opens the court portal — who may file, preconditions, division and language, mandatory content, attachments with their screen labels, signing, the fee from the official 2026 table (with the SME reduction) and the time-limit rule — as a PASS / FIX / N/A checklist with a go / not-ready verdict. Use when the user asks what they need to file or how to prepare a UPC Statement of claim, Statement of defence, counterclaim, revocation action, application to amend, preliminary objection, reply, rejoinder, provisional measures or evidence application, protective letter or its extension, appeal, cross-appeal, suspensive effect, action against an EPO decision, or an application under a Rule of Procedure. For what can be filed next in a case use upc-case-navigator; for division and language alone use upc-division-router; for the meaning of a rule use upc-rop-explainer; for opt-outs use upc-opt-out-check and upc-opt-out-actions.
user-invocable: true
---

# UPC Filing Preparation

Prepare ONE UPC Filing. Give a checklist in chat and a verdict. Stop at the court portal: never file, never sign, never pay for the user.

Two rules apply to every answer:
- **No calendar date.** Give the rule, the period and the trigger event ("2 months from service of the Statement for revocation, RoP 49.1"). The representative computes the date (service rules RoP 270–279 and RoP 300–301 move it). You may state the fixed dates of the fee table (for example "in force from 1 January 2026").
- **Law first.** Where the court's screens and the law disagree, state the law and name the form limit. The reference files mark these rows "Form vs law".

## 1. Identify the filing
Find the filing, our side and the case context (Initial Filing or Subsequent Filing in a UPC Case, the patent, the parties, the client's size). Ask for a missing fact only when the checklist cannot go on without it; otherwise mark that row FIX and continue.
- An opt-out, its withdrawal or correction is not a court filing here → send the user to `upc-opt-out-check` (eligibility) and `upc-opt-out-actions` (the request).
- "What can we file next?" → `upc-case-navigator`, then come back for the filing the user picks.

## 2. Read the family reference file
Read the file for the filing and use its rules, periods and screen labels as written:

| Filing | File |
|---|---|
| Statement of claim, preliminary objection, Statement of defence, counterclaims, reply, rejoinder | [infringement.md](references/infringement.md) |
| Statement for revocation, Defence to revocation, application to amend the patent | [revocation.md](references/revocation.md) |
| Preserve evidence, inspection, freezing, provisional measures | [evidence-and-provisional-measures.md](references/evidence-and-provisional-measures.md) |
| Protective letter and its extension | [protective-letters.md](references/protective-letters.md) |
| Appeal, appeal against an order, response, cross-appeal, suspensive effect | [appeal.md](references/appeal.md) |
| Action against an EPO decision | [action-against-epo-decisions.md](references/action-against-epo-decisions.md) |
| Applications under a Rule inside a case, other filings (non-infringement, damages, licences), correction of deficiencies | [applications-and-other-filings.md](references/applications-and-other-filings.md) |
| Fees (every filing) | [fees-2026.md](references/fees-2026.md) |
| Which side files what, after which event | [next-filings.md](references/next-filings.md) |

**Fees:** take every amount from `fees-2026.md` only, and state it as its section "How to state a fee" says (rule, table version, SME reduction, pre-2026 actions, RoP 15.2).

## 3. Division and language
Apply the division and language rules of the family file, then check them with `upc-division-router` ([its skill](../upc-division-router/SKILL.md), [division list](../upc-division-router/references/divisions.md)). For the central division, name the section by the patent's IPC class, or mark FIX and ask for the class. A protective letter goes to the Registry, not to a division.

## 4. Build the checklist
One row per item, in this order: Who may file · Preconditions · Division · Language · Mandatory content (with its rule; list the items) · Attachments (the screen labels, in quotes) · Signing · Fee · Time limit (rule, period, trigger event) · Form vs law (when the file has one).

Table columns: **Item · Status (PASS / FIX / N/A) · What to do**. PASS = the user's facts meet it. FIX = something is missing or must be done; say exactly what. N/A = it does not apply to this filing. Cite the RoP rule or UPCA article in each row.

## 5. Verdict
End with **Go** (no FIX row) or **Not ready** (list the FIX rows to close). Then one line: the court portal is the next step, and the user files. If the user may need a rule in plain words, point to `upc-rop-explainer`. The analysis-support-not-legal-advice note is emitted once per response by the system prompt — do not restate it.
