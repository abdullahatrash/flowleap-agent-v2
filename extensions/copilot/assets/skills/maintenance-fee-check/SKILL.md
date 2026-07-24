---
name: maintenance-fee-check
description: Check US patent maintenance-fee status and deadlines — compute the 3.5/7.5/11.5-year windows from the grant date, read which fees were actually paid from USPTO transaction events, and report the next docketable deadline with surcharge dates. Use when the user asks whether maintenance fees are due or paid, when the next fee deadline is, whether a US patent is still in force fee-wise, or for a fee-status sweep over a portfolio. Dates and status only — for fee-reduction eligibility use fee-reduction-advisor; for term estimates use get_patent_term.
user-invocable: true
---

# Maintenance-Fee Check

Compute maintenance-fee deadlines for US utility patents and report what is
paid, due, and docketable — from official USPTO data, never from memory.

**Scope guard — dates and status only.** Fee *amounts* depend on the current
USPTO fee schedule and entity status and change over time. Never state dollar
amounts; link https://www.uspto.gov/learning-and-resources/fees-and-payment
and report the entity status found on the record so the user can look up the
right column.

## Step 1 — Applicability guard (run before any computation)

Fetch the grant record: `uspto_api_guide` (endpoint "grants") →
`patent_api_request` GET `/patent-search-uspto/grants/{patentNumber}` (or
`/patent-search-uspto/applications/{applicationNumberText}` when you have the
application number).

From `applicationMetaData`, check the application type **first**:

- **Design or plant patent** → answer "this patent type has no maintenance
  fees" and stop. Utility patents only.
- **Reissue** → out of scope for computation: maintenance fees follow the
  ORIGINAL patent's schedule (MPEP 2504). Say so, point at the original
  patent, and stop.
- **Utility** → record `grantDate`, `applicationNumberText`, and
  `entityStatusData` (large/small/micro — determines which fee column
  applies), then continue.

No grant date (pre-grant application) → there is nothing to compute; say so.

## Step 2 — Read what was actually paid

`patent_api_request` GET
`/patent-search-uspto/applications/{applicationNumberText}/transactions`
(see `uspto_api_guide` endpoint "file-wrapper-subresources").

Scan `eventDataBag` for:

- **Payment events** — codes `M1551`/`M1552`/`M1553` (4th/8th/12th-year,
  large entity) and `M2551`/`M2552`/`M2553` (small/micro variants). Record
  the event date per window.
- **Expiry events** — descriptions like "Patent Expired for Failure to Pay
  Maintenance Fees" (code starting `EXP`). An expiry event ends the analysis:
  report the lapse and its date.

**Required phrasing:** a window with no payment event is "no payment event
recorded" — never "unpaid." ODP ingestion lags; a fee paid recently may not
appear yet.

## Step 3 — Compute the windows

All dates run from **grant date** (PTA does not move them):

| Window | Opens | Due | Surcharge until | Expires if unpaid |
|--------|-------|-----|-----------------|-------------------|
| 4th-year | grant + 3y | grant + 3.5y | grant + 4y | grant + 4y |
| 8th-year | grant + 7y | grant + 7.5y | grant + 8y | grant + 8y |
| 12th-year | grant + 11y | grant + 11.5y | grant + 12y | grant + 12y |

Ground the rule text with `search_legal` ("maintenance fee due dates
surcharge", jurisdiction USPTO — 37 CFR 1.362, MPEP Chapter 2500) rather than
asserting it. If all three windows are past, report historical status only.

## Step 4 — Report

Per patent, a three-row table — Window | Due | Surcharge until | Status —
where Status is one of: paid on date (event code) / upcoming /
**in surcharge period** / no payment event recorded / lapsed on date.
Then exactly one action line:

> **Next action: docket [the nearest unmet deadline]**

**Portfolio mode:** given a list of patents (or hits from `search_patents`),
run the same check per patent and present one summary table sorted by next
deadline, nearest first.

Every response ends with the verification footer:

> Computed from USPTO ODP transaction records as of [retrieval date] —
> verify in USPTO Patent Center before docketing. Fee amounts: USPTO fee
> schedule (entity status on record: [status]).

The analysis-support-not-legal-advice note is emitted once per response by
the system prompt — do not repeat it per patent.
