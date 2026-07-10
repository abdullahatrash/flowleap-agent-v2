---
name: upc-division-router
description: Routes a Unified Patent Court dispute to the right court-of-first-instance division and identifies the languages of proceedings each allows — the local and regional divisions vs the central division seats (Paris, plus the Munich and Milan sections split by IPC technical area) and the Court of Appeal in Luxembourg — with the forum rules (infringement goes to the division of the infringement place or the defendant's domicile, standalone revocation goes to the central division, a revocation counterclaim can stay with the local division or be bifurcated) and the counter-move map for a defendant. Use when the user asks which UPC division hears an infringement or revocation action, where to file a UPC case, the language of proceedings for a particular division, how central-division tech-area allocation works, or how to counterclaim against an infringement suit. For opt-out eligibility use upc-opt-out-check; for a Rule of Procedure number use upc-rop-explainer.
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
Language depends on the division (see the reference table): a German local division runs in **German or English**; the Nordic-Baltic regional division runs in **English**; the central division typically runs in the **language of the patent**; the Court of Appeal in Luxembourg accepts **all UPC languages**. Confirm the specific division's designated language(s) before advising.

## Counter-move map (defendant)
Facing an infringement action, the defendant's typical moves are a **counterclaim for revocation** (attacking validity in the same forum, subject to the bifurcation options above) and a **counterclaim relating to licences**. Name these when the user is on the defence side.

## Output
Identify the eligible division(s) for the action type, the language(s) that division allows, the central-division section if revocation routes there, and — for a defendant — the available counterclaims. The analysis-support-not-legal-advice note is emitted once per response by the system prompt — do not restate it per section.
