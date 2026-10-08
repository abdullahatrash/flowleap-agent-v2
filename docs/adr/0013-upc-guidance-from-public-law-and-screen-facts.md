# UPC guidance comes from public law and screen facts, and never computes a deadline date

**Status:** accepted (2026-10-08)

FlowLeap adds skills that help UPC representatives prepare a UPC Filing (**Filing Preparation**)
and see what can be filed next in a UPC Case (**Case Navigation**). The source material is a
private UPC practice knowledge base, kept outside this repo. It mixes three kinds of content:
public law (UPCA, Rules of Procedure, the court-fee table), facts that any registered user sees
on the court's filing screens (wizard steps, mandatory fields, attachment types, signing rules),
and internal implementation detail of the court's case-management system (CMS). The CMS
computes no procedural deadline and checks neither the order of filings nor the side that files.

## The decisions

1. **Only public law and screen facts ship.** Skills state the law with its rule or article, and
   describe the CMS only as a user sees it, with the screen labels. Internal procedure codes,
   decision-table logic, service names and CMS defects never appear in a skill. Rejected:
   shipping the CMS model as-is (it exposes internal system detail and teaches defects as rules).
2. **Where the form and the law disagree, the skill states the law and names the form limit.**
   Example: the law requires every proprietor to join an opt-out, but the form accepts one
   proprietor. The skill says both. Rejected: silently following the form.
3. **Skills never compute a calendar date.** Case Navigation gives the rule, the period and the
   trigger event ("2 months from service of the decision, R.224.1(a)"). The representative
   computes the date. Rejected: computing dates (service rules, R.300–301 period ends and court
   holidays make a wrong date likely, and a wrong date in a court case is a serious error).
4. **Fees come from the official table, never from the CMS.** Each amount carries the table's
   version, its URL and a date stamp; actions filed before 2026-01-01 use the 2023 table.
   Rejected: CMS fee values (several conflict with each other and with the official table).

## Consequences

- The knowledge base stays outside the repo. Reference files in the skills are rewritten from it,
  not copied.
- The founder confirms the right to use the source material before the first release that
  contains the skills.
- A practitioner reviews the legal content before release; until then the new skills are not
  registered in `chatSkills` (PRD 0021).
- The existing `upc-rop-explainer` rule "never computes party-specific deadlines" becomes the
  rule for every UPC skill.
