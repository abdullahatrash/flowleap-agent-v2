# UPC Evidence Orders and Provisional Measures (RoP 192, 199, 200, 206) — Reference

**Sources:** UPC Rules of Procedure (RoP, official consolidated text, plus the rules that decision D-AC/08/02072025 replaced: RoP 198, 213, 370), UPC Agreement (UPCA), the court's fee guidelines as amended by the same decision, official 2026 Table of Court Fees. URLs and the check date are in `fees-2026.md`. Screen labels are the labels on the court's filing screens. **Caveat:** the RoP, the UPCA and the court's orders govern. This file is a preparation aid, not legal advice. It never gives a calendar date.

## One screen, four applications

The screen "Application for Evidence and provisional measures" opens a new case. The field "Type of evidence and provisional measures" selects the legal basis:

| Screen value | Application | Law |
|---|---|---|
| RoP 192 (evidence) | Application for preserving evidence (incl. saisie) | Art. 60 UPCA; RoP 192–198 |
| RoP 199 (inspection) | Application for an order for inspection of products, devices, methods, premises or local situations | Art. 60 UPCA; RoP 199 (RoP 192–198 apply) |
| RoP 200 (freeze of assets) | Application for an order to freeze assets | Art. 61 UPCA; RoP 200 (RoP 192–198 apply) |
| RoP 206 (provisional measures) | Application for provisional measures (injunction and other measures) | Art. 32(1)(c), 62 UPCA; RoP 205–213 |

## The application (Initial Filing, or filed during the merits action)

| Item | What applies |
|---|---|
| Who may file | A party within Art. 47 UPCA (RoP 192.1, 206.1): proprietor, or licensee under Art. 47(2)–(3). |
| Preconditions | Before or after the merits action starts (RoP 192.1, 200.1, 206.1). Evidence: at the division of the pending infringement action, or of the intended merits action (RoP 192.1). Check for a protective letter: the Registry does it (RoP 208.1). Division and language → `upc-division-router`. |
| Language | After the merits action started: its language of proceedings. Before: RoP 14 applies (RoP 192.4, 206.5). |
| Mandatory content — evidence, inspection, freezing (RoP 192.2) | (a) RoP 13.1(a)–(i) particulars; (b) the measures requested and the exact location of the evidence, where known or suspected; (c) why the measures are needed to preserve relevant evidence; (d) facts and evidence. Before the merits action: also a concise description of the action to be started, with its facts and evidence. Freezing: reasonably available and plausible evidence of infringement (RoP 200.1). |
| Mandatory content — provisional measures (RoP 206.2) | (a) RoP 13.1(a)–(i) particulars; (b) the measures requested (RoP 211.1); (c) why they are necessary; (d) facts and evidence, including urgency and the matters of RoP 211.2–.3; (e) a concise description of the merits action to be started. |
| Without hearing the defendant (ex parte) | Add the reasons for not hearing the defendant (RoP 197), and for provisional measures any prior correspondence (RoP 192.3, 206.3). Duty to disclose every material fact, including pending proceedings and earlier failed attempts (RoP 192.3, 206.4). Screen: tick "Wish to order provisional measures without hearing the other party". |
| Extreme urgency | The standing judge may decide at once (RoP 194.4, 209.3). Screen: tick "Extreme urgency". |
| Attachments (screen labels) | "Application for provisional measures" (mandatory for all four types); "Exhibit Claimant"; "Document Claimant"; "Proof of entitlement to fee reduction" (if claimed); "Proof of payment" (if "already paid"). |
| Other screen fields | Patent numbers (EP + 7 digits); court division; language; "Anticipated value" (EUR); parties: applicant, applicant representative, defendant (mandatory), proprietor; SPC data (optional). |
| Signing | A representative of the applicant. |
| Fee | Evidence / inspection / freezing: RoP 192.5, 199.2, 200.2. Provisional measures: RoP 206.5. Fixed + value-based fee → `fees-2026.md` §1, §2. Not lodged until paid (RoP 15.2 applies). |
| Value (fee guidelines, as a general rule) | Provisional measures: 2/3 of the value of the actual or expected permanent injunction. Evidence and inspection: 1/5 of the value of the main action. Freezing: 1/5 of the damages claim, taking the frozen assets into account. |
| Time limit | No fixed period to apply. Urgency is a factor (RoP 194.2(a), 209.2(b)); delay can defeat the application. |
| Form vs law | Law: the value-based fee applies to all four types when the value exceeds EUR 500,000, except for evidence, inspection and freezing when an infringement action between the same parties on the same patent is pending (RoP 370.3). Form: "Anticipated value" is mandatory only for RoP 206; for the other types it is optional. Enter the value whenever the value-based fee applies. |

## After the order: periods that the law sets

| Step | Side | Rule, period, trigger |
|---|---|---|
| Start the merits action | Applicant | RoP 198.1 (evidence, inspection, freezing) and RoP 213.1 (provisional measures): within 31 calendar days or 20 working days, whichever is longer, from the date that the order specifies. The Court cannot extend this period (RoP 9.4). If missed, the order is revoked on the defendant's request. |
| Request to revoke the order (merits action not started) | Defendant | RoP 198.1 / 213.1; fee RoP 198.3 / 213.3 → `fees-2026.md` §3. Screen: Application types "RoP 198.1 - Request order to preserve evidence to be revoked or otherwise cease to have effect" and "RoP 213.1 - Request provisional measures to be revoked or otherwise cease to have effect". |
| Request for review of an ex parte order | Defendant | RoP 197.3 (and RoP 212.3): within 30 days after execution of the measures; content: reasons and facts and evidence. Screen: Application type "RoP 197.3 - Request to review an ex parte order". No fee in the 2026 table. |
| Compensation after revocation or lapse | Defendant | RoP 198.2 / 213.2 (no fixed period). |
| Appeal against the order | Party adversely affected | RoP 220.1(c), 224.1(b): 15 days from service of the order → `appeal.md`. |

## Filings inside the case

| Filing (screen title) | Side | Rule and period | Mandatory attachment (screen label) |
|---|---|---|---|
| Objection to the Application for evidence and provisional measures | Defendant | RoP 194.1(a) / 209.1(a): within the period the Court specifies when it invites an objection. Content: why the application fails; facts and evidence; if no merits action yet, why that action will fail. | "Statement of defence" |
| Reply to the objection to the Application for evidence and provisional measures | Applicant | No RoP period: only as the Court orders. | "Statement of reply" |
| Rejoinder to the reply to the objection to the Application for evidence and provisional measures | Defendant | No RoP period: only as the Court orders. | "Statement of rejoinder" |
| Evidence and provisional measures withdrawal | Applicant | RoP 194.5 / 209.4: when the Court decides to hear the defendant (or refuses an ex parte order), the applicant may withdraw and ask that the application stay confidential. RoP 194.6 / 209.5: same right when a protective letter exists. Otherwise RoP 265. | "Provisional measures withdrawal request" |

No fee for these four filings.
