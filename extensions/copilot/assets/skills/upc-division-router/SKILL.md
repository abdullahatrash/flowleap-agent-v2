---
name: upc-division-router
description: Route a Unified Patent Court case to the right division and language of proceedings: local and regional divisions, the central division seats in Paris, Munich and Milan, and the Court of Appeal. Use when the user asks which UPC division hears an infringement or revocation action, where to file, the language of proceedings, or how to counterclaim. For opt-out eligibility use upc-opt-out-check; for a Rule of Procedure number use upc-rop-explainer.
user-invocable: true
---

# UPC Division & Language Router

Given a UPC dispute, point to the division that hears it and the language it will run in, and map the defendant's counter-moves. The first-instance court is one court with many divisions plus a central division; the Court of Appeal sits in Luxembourg.

The full division/seat/language table and forum rules, date-stamped with the "official rules govern" caveat, live in [references/divisions.md](references/divisions.md).

## Forum rules (where an action goes)
- **Infringement** → a **local or regional division**: the division for the place of (threatened) infringement, or the division for the defendant's domicile/place of business. Where several apply, the claimant chooses.
- **Standalone revocation** → the **central division**.
- **Revocation counterclaim** raised inside an infringement action → the local/regional division may **keep it** (hear infringement and validity together), **refer just the revocation** to the central division (bifurcation) while staying or proceeding on infringement, or refer the whole case with the parties' agreement.

## Central division tech-area split
The central division has seats/sections in **Paris**, **Munich**, and **Milan**, with subject matter allocated by **IPC technical area** (e.g. Munich and Milan sections carry defined IPC fields, Paris carries the remainder). Route a central-division case by the patent's IPC classification.

## Language of proceedings
Use the official list in the reference table. Every local division offers its national language(s) and English; the Nordic-Baltic regional division runs in **English** only. The central division, and a local division where the parties agree, may use the **language in which the patent was granted**. The Court of Appeal in general uses the **language of the first-instance proceedings**. For divisions marked * in the table, R.14.2(c) lets the judge-rapporteur order that the national language is used in the hearing and in decisions (with a certified translation). Confirm the division's languages against the official list before advising.

## Counter-move map (defendant)
Facing an infringement action, the defendant's typical moves are a **counterclaim for revocation** (attacking validity in the same forum, subject to the bifurcation options above) and a **counterclaim relating to licences**. Name these when the user is on the defence side.

## Output
Identify the eligible division(s) for the action type, the language(s) that division allows, the central-division section if revocation routes there, and — for a defendant — the available counterclaims. The analysis-support-not-legal-advice note is emitted once per response by the system prompt — do not restate it per section.
