---
name: upc-opt-out-check
description: Checks whether a European patent is eligible to be opted out of the Unified Patent Court's jurisdiction, given an EP number — the hard blocker is unitary effect (a patent with unitary effect cannot be opted out), verified from EP Register / legal-status data; authoritative opt-out status is only ever confirmed by linking the public UPC Registry, never asserted from backend data. Use when the user asks whether an EP patent can be opted out of the UPC, about opt-out eligibility, whether unitary effect blocks an opt-out, or whether a patent is already opted out. For the opt-out/withdrawal/correction request types and their requirements use upc-opt-out-actions; for the Rules of Procedure use upc-rop-explainer; for which division hears a case use upc-division-router.
user-invocable: true
---

# UPC Opt-Out Eligibility Check

Given an EP number, determine whether the patent can be opted out of the Unified Patent Court, and hand the user to the authoritative registry for the current opt-out STATUS. Eligibility (can it be opted out at all) is a data question this skill answers; status (is it opted out right now) is not — see the honesty rule below.

Eligibility rules, date-stamped with the "official sources govern" caveat, live in [references/opt-out-eligibility.md](references/opt-out-eligibility.md).

## Step 1 — Resolve the patent and its unitary effect
Take the EP publication number from the user. Read its register/legal state:
- `get_legal_status` (publicationNumber) — grant, lapse, and the unitary-effect signal.
- `get_register_events` (publicationNumber) — the EP Register carries unitary-patent register data (request for unitary effect, registration of unitary effect).
- Advanced fallback for the unitary-patent register only: raw `ops_api_guide` endpoint "register-upp" for the detailed UPP record.

## Step 2 — Apply the hard blocker
**A patent with unitary effect CANNOT be opted out.** This is the exact validation the UPC case-management system enforces: unitary effect and opt-out are mutually exclusive. Report the blocker as a clear yes/no grounded in the Step 1 data:
- Unitary effect registered → **not eligible** to opt out. Stop; explain why.
- No unitary effect (a classic bundle EP validated nationally) → **eligible in principle**, subject to the status check below.

Also flag, without asserting it as fact: a **pending UPC action** on the patent blocks a new opt-out. You cannot see UPC docket state from backend data — name it as a gate the user must confirm at the registry.

## Step 3 — Honesty rule: status lives only in the public UPC Registry
Authoritative opt-out STATUS is held only in the public UPC Registry — https://www.unified-patent-court.org/en/registry. Never claim to know whether a patent is currently opted out from backend data, and never scrape the registry. Always LINK it and instruct the user to confirm the live opt-out status and any pending-action gate there.

## Output
Report: (1) unitary-effect blocker — yes/no, with the register/legal-status evidence it rests on; (2) resulting eligibility call; (3) the UPC Registry link for authoritative status confirmation, stated as the only source of truth for current opt-out status. For the mechanics of filing/withdrawing/correcting an opt-out, point to upc-opt-out-actions. The analysis-support-not-legal-advice note is emitted once per response by the system prompt — do not restate it per section.
