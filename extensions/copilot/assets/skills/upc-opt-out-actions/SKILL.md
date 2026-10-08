---
name: upc-opt-out-actions
description: The five UPC opt-out request types, opt-out, withdrawal, correction, and removal of an unauthorized opt-out or withdrawal, with their requirements and lock-in rules. Use when the user asks how to file, withdraw or correct an opt-out, who must sign one, whether it costs a fee, whether it can be reversed, or what litigation does to opt-out rights. For eligibility use upc-opt-out-check; for the Rules of Procedure use upc-rop-explainer.
user-invocable: true
---

# UPC Opt-Out Request Types

Explain the five opt-out request types, what each one needs, and the timing rules that lock an option in or out. This skill is about the request. Whether a patent is eligible at all is a separate question: see upc-opt-out-check.

The request-type table, the requirements with their rules, and the screen labels are in [references/opt-out-actions.md](references/opt-out-actions.md).

## Step 1 — Name the request type
Match the user's situation to one type:
1. **Initial opt-out** (R.5.1) — takes a classic bundle EP (or a published EP application) out of the exclusive competence of the UPC.
2. **Withdrawal of an opt-out** (R.5.7) — opts back in. After the withdrawal is entered in the register, the patent can **never be opted out again** (R.5.10).
3. **Correction** (R.5.5) — corrects missing or incorrect particulars in the register. The filing screens label it **"Opt-out/withdrawal correction"**. The opt-out is effective from the date of the correction.
4. **Removal of an unauthorized opt-out** (R.5A) — the proprietor asks the Registrar to delete an opt-out lodged without authority.
5. **Removal of an unauthorized withdrawal** (R.5A) — the same for a withdrawal lodged without authority.

## Step 2 — Check who must lodge it
- **The law:** where there are two or more proprietors, **all proprietors must lodge** the opt-out (R.5.1(a)), and the same applies to a withdrawal (R.5.7). The opt-out covers all states of the patent (R.5.1(b)). An SPC holder who is not the proprietor joins too (R.5.2(a)).
- **The form limit:** the filing form accepts **only one** proprietor. Tell the user both facts. The law, not the form, decides if the opt-out is valid. Advise them to get the authority of every co-proprietor before filing, and to ask the Registry how to record the other co-proprietors (for example in an attached statement that names each one and its declaration).
- A person not recorded as proprietor in the register lodges a declaration of entitlement (R.5.1(a), R.5.3(e)). No representative is required. No fee is charged.

## Step 3 — Explain what happens after a removal request
A removal request does **not** remove the entry at once. The Registrar first marks the opt-out or the withdrawal as **subject to an Application for removal** (R.5A.2); the register shows it as pending removal. The Registrar then decides. Only a final decision to remove deletes the entry. The decision can be reviewed by the President of the Court of Appeal on an application lodged within one month of notification (R.5A.3).

## Step 4 — Flag the lock-in and lock-out rules
- **No opt-out after a UPC action** commenced on the patent before the opt-out (or its correction) is entered in the register, whether the action is pending or concluded (R.5.6).
- **No withdrawal after a national action** on the patent commenced before the withdrawal is entered (R.5.8).
- **No new opt-out after a withdrawal** (R.5.10).

## Step 5 — Output
Give the request type, its requirements (proprietors, declaration, fee, representation), the form limit where it applies, and every timing rule that applies. Never give a calendar date. The analysis-support-not-legal-advice note is emitted once per response by the system prompt — do not restate it per section.
