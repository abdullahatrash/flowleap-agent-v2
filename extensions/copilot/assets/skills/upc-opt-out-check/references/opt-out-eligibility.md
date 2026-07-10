# UPC Opt-Out Eligibility — Reference

**Compiled:** 2026-07-10. Derived from a study of the Unified Patent Court case-management system's opt-out validation behaviour plus the UPC Agreement and Rules of Procedure. **Caveat:** the UPC Agreement, the Rules of Procedure, and the public UPC Registry govern; treat everything below as an analysis aid, not authority. The authoritative current opt-out status of any patent lives only in the public UPC Registry (https://www.unified-patent-court.org/en/registry) — confirm there, do not scrape it, and never assert live status from backend data.

## The hard blocker: unitary effect

| Patent state | Opt-out eligible? | Why |
|--------------|-------------------|-----|
| Unitary effect registered (a European patent with unitary effect / "unitary patent") | **No** | The UPC has exclusive, non-derogable jurisdiction over unitary patents. Opt-out and unitary effect are mutually exclusive — the CMS rejects the opt-out. |
| Classic bundle EP (validated nationally, no unitary effect) | **Yes, in principle** | During the transitional period a bundle EP may be opted out of UPC jurisdiction, subject to the no-pending-action gate. |
| Pending UPC action already on the patent | **No (blocked)** | An opt-out cannot be entered once a UPC action has been brought. Docket state is not visible in backend data — confirm at the registry. |

## Where the unitary-effect signal comes from

- `get_legal_status` — grant/lapse plus the unitary-effect indicator.
- `get_register_events` — the EP Register records the request for unitary effect and its registration; these events are the primary signal that the patent is (or is becoming) unitary.
- Advanced fallback: the `ops_api_guide` "register-upp" endpoint exposes the detailed unitary-patent register record for edge cases; the typed tools above cover the common check.

## Status vs eligibility — the line the skill must hold

- **Eligibility** (can this patent be opted out at all) is a data question answered from register/legal-status: mainly the unitary-effect blocker.
- **Status** (is this patent opted out right now) is NOT derivable from backend data. It is held only in the public UPC Registry. The skill links the registry and instructs confirmation there; it never claims to know status.
