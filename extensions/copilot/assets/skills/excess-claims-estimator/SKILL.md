---
name: excess-claims-estimator
description: Counts the claims in a draft, applies the EPO (over 15) and USPTO (over 20 total / 3 independent) excess-claim thresholds, and presents the per-claim surcharge as a table. Use when the user asks about claims fees, excess-claim surcharges, how much extra claims cost, whether they have too many claims, or the cost of filing N claims at the EPO or USPTO. For fee reductions use fee-reduction-advisor; for overall filing readiness use pre-filing-checklist.
user-invocable: true
---

# Excess-Claims Fee Estimator

Turn a claim set into an excess-claim surcharge estimate. The threshold amounts drift, so this skill's job is the **counting and threshold arithmetic**; present every currency figure as "verify against the current fee schedule".

Threshold values and worked examples, date-stamped with the "schedule governs" caveat, live in [references/claim-fee-thresholds.md](references/claim-fee-thresholds.md).

## Step 1 — Count the claims
Get the claim set from the user. If it is in a file or a patent, use `read_file`, `get_patent_details`, or `analyze_claim` to extract it rather than asking the user to retype. Count:
- **Total claims** (all independent + dependent).
- **Independent claims** (needed for the USPTO independent-claim threshold).

Multiple-dependent claims can count differently at some offices — flag if present rather than guessing.

## Step 2 — Apply thresholds
- **EPO** — a per-claim fee applies to each claim **above 15**. Claims 16–50 are charged at one rate; the 51st claim onward at a higher rate.
- **USPTO** — fees apply to each claim **over 20 total** and each **independent claim over 3**.

Arithmetic pattern, e.g. **22 claims (4 independent)**: EPO surcharges **7** claims (16th–22nd); USPTO surcharges **2** claims on the total (21st–22nd) and **1** excess independent claim.

## Step 3 — Present the table
| Office | Threshold | Excess claims | Rate band | Est. surcharge (verify) |
|--------|-----------|---------------|-----------|-------------------------|
| EPO | over 15 | N | 16–50 / 51+ | per-claim × N |
| USPTO | over 20 total; over 3 independent | N_total / N_indep | per-claim | per-claim × count |

Fill excess counts from the actual claim set; keep amounts as illustrative reference values labelled "verify against the current fee schedule". If reducing claim count is cheap (merging dependents, deleting redundant claims), note how many claims would drop the applicant back under a threshold.

The analysis-support-not-legal-advice note is emitted once per response by the system prompt — do not restate it per office.
