# UPC Opt-Out Eligibility — Reference

**Sources (checked 2026-10-08):** Article 83 UPC Agreement; Rules 5.6, 5.9 and 5.10 of the Rules of Procedure, consolidated text at https://www.unifiedpatentcourt.org/sites/default/files/upc_documents/Consolidated%20Rules%20of%20Procedure%20UPC_EN.pdf; the opt-out filing form as users see it. **Caveat:** the UPC Agreement, the Rules of Procedure, and the public UPC Registry govern; treat everything below as an analysis aid, not authority. The authoritative current opt-out status of any patent lives only in the public UPC Registry (https://www.unifiedpatentcourt.org/en/registry/opt-out) — confirm there, do not scrape it, and never assert live status from backend data.

## The hard blocker: unitary effect

| Patent state | Opt-out eligible? | Why |
|--------------|-------------------|-----|
| Unitary effect registered (a European patent with unitary effect / "unitary patent") | **No** | The UPC has exclusive, non-derogable jurisdiction over unitary patents. Opt-out and unitary effect are mutually exclusive — the opt-out filing form refuses the patent number. |
| Classic bundle EP (validated nationally, no unitary effect) | **Yes, in principle** | During the transitional period a bundle EP may be opted out of UPC jurisdiction, subject to the no-earlier-UPC-action gate (R.5.6). |
| Opted-out application granted with unitary effect | **Opt-out ends** | The opt-out is deemed withdrawn and the Registrar enters the withdrawal (R.5.9). After that entry no new opt-out is possible (R.5.10). |
| UPC action commenced on the patent before the opt-out is entered | **No (ineffective)** | The opt-out is ineffective, whether the action is pending or concluded (R.5.6). Docket state is not visible in backend data — confirm at the registry. |

## Where the unitary-effect signal comes from

- `get_legal_status` — grant/lapse plus the unitary-effect indicator.
- `get_register_events` — the EP Register records the request for unitary effect and its registration; these events are the primary signal that the patent is (or is becoming) unitary.
- Advanced fallback: the `ops_api_guide` "register-upp" endpoint exposes the detailed unitary-patent register record for edge cases; the typed tools above cover the common check.

## Status vs eligibility — the line the skill must hold

- **Eligibility** (can this patent be opted out at all) is a data question answered from register/legal-status: mainly the unitary-effect blocker.
- **Status** (is this patent opted out right now) is NOT derivable from backend data. It is held only in the public UPC Registry. The skill links the registry and instructs confirmation there; it never claims to know status.
