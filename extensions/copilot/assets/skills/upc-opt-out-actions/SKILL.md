---
name: upc-opt-out-actions
description: Explains the five UPC opt-out request types the Court's case-management system models — initial opt-out, withdrawal (opting back in), correction, and removal of an unauthorized opt-out or unauthorized withdrawal — with their differing requirements (all proprietors of all national parts must join, a declaration of proprietorship, no fee) and the lock-in/lock-out rules (no opt-out once a UPC action has started, no withdrawal once a national action has started, and no second opt-out after a withdrawal). Use when the user asks how to file, withdraw, or correct a UPC opt-out, who must sign an opt-out, whether an opt-out costs a fee, whether an opt-out can be reversed, or what happens to opt-out rights once litigation starts. For whether a patent is eligible to be opted out at all use upc-opt-out-check; for the Rules of Procedure use upc-rop-explainer.
user-invocable: true
---

# UPC Opt-Out Request Types

Explain the five opt-out request types the Unified Patent Court's case-management system models, their differing requirements, and the timing rules that lock an option in or out. This skill is about the mechanics of the request; whether a given patent is eligible at all is a separate question — see upc-opt-out-check.

The full request-type matrix and requirements, date-stamped with the "official rules govern" caveat, live in [references/opt-out-actions.md](references/opt-out-actions.md).

## The five request types
1. **Initial opt-out** (Rule 5 RoP) — removes a classic bundle EP from UPC jurisdiction. Effective for the life of the patent unless withdrawn.
2. **Withdrawal of an opt-out** (opting back in) — returns the patent to UPC jurisdiction. Once withdrawn, the patent **cannot be opted out again** — this is a one-way door.
3. **Correction of an opt-out** — fixes errors in a filed opt-out (e.g. proprietor details) without withdrawing it.
4. **Removal of an unauthorized opt-out** — deletes an opt-out that was entered without the proprietors' authority.
5. **Removal of an unauthorized withdrawal** — reverses a withdrawal that was entered without authority.

## Requirements common to an opt-out
- **All proprietors of all national parts** of the bundle must join — every proprietor of every designated state, not just one. A missing co-proprietor makes the opt-out ineffective.
- A **declaration of proprietorship** is lodged with the request.
- **No fee** is charged for an opt-out.
- A registered European Patent Attorney or UPC representative is **not required** to lodge an opt-out, though it is common to use one.

## The lock-in / lock-out rules
- **No opt-out once a UPC action has started** — bringing an action before the UPC on the patent forecloses opting it out.
- **No withdrawal once a national action has started** — a national-court action on the patent forecloses withdrawing the opt-out (opting back in).
- **No re-opt-out after withdrawal** — withdrawal is final; the patent stays under UPC jurisdiction thereafter.

## Output
Identify which of the five request types the user's situation calls for, list that type's requirements (proprietor set, declaration, fee, representation), and flag any lock-in/lock-out rule that applies to their timing. The analysis-support-not-legal-advice note is emitted once per response by the system prompt — do not restate it per section.
