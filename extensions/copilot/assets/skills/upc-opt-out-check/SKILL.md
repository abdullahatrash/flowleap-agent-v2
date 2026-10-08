---
name: upc-opt-out-check
description: Whether an EP patent can be opted out of the Unified Patent Court, given its number: unitary effect is the hard blocker, and authoritative status comes only from the public UPC Registry. Use when the user asks about opt-out eligibility, whether unitary effect blocks an opt-out, or whether a patent is already opted out. For the request types use upc-opt-out-actions; for the Rules of Procedure use upc-rop-explainer; for which division hears a case use upc-division-router.
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
**A patent with unitary effect CANNOT be opted out.** The UPC has exclusive competence over it, and the opt-out filing form refuses a patent number with unitary effect. Report the blocker as a clear yes/no grounded in the Step 1 data:
- Unitary effect registered → **not eligible** to opt out. Stop; explain why.
- No unitary effect (a classic bundle EP validated nationally) → **eligible in principle**, subject to the status check below.

**Unitary effect also ends an existing opt-out.** Where an opted-out EP application proceeds to grant as a European patent with unitary effect, the opt-out is deemed withdrawn and the Registrar enters the withdrawal in the register (R.5.9). Tell the user this when the application was opted out and unitary effect was requested or registered: the opt-out no longer protects the patent, and a new opt-out is not possible (R.5.10).

Also flag, without asserting it as fact: a **UPC action commenced on the patent** before the opt-out is entered makes the opt-out ineffective, whether the action is pending or concluded (R.5.6). You cannot see UPC docket state from backend data — name it as a gate the user must confirm at the registry.

## Step 3 — Honesty rule: status lives only in the public UPC Registry
Authoritative opt-out STATUS is held only in the public UPC Registry — https://www.unifiedpatentcourt.org/en/registry/opt-out. Never claim to know whether a patent is currently opted out from backend data, and never scrape the registry. Always LINK it and instruct the user to confirm the live opt-out status and any earlier UPC action there.

## Output
Report: (1) unitary-effect blocker — yes/no, with the register/legal-status evidence it rests on; (2) resulting eligibility call; (3) the UPC Registry link for authoritative status confirmation, stated as the only source of truth for current opt-out status. For the mechanics of filing/withdrawing/correcting an opt-out, point to upc-opt-out-actions. The analysis-support-not-legal-advice note is emitted once per response by the system prompt — do not restate it per section.
