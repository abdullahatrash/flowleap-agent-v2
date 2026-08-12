# Patent report template structures — validation against primary sources

**Date:** 2026-08-12
**Templates reviewed:** `extensions/copilot/src/extension/tools/common/patentReportTemplates.ts` (8 templates behind `write_patent_results`)
**Method:** each template's section list was compared against the authoritative document that owns the corresponding professional report shape. Every structural claim below cites its source URL. Where a source could not be reached, the claim is marked **unverified** instead of invented.

**Source-access notes (unreachable / rerouted sources):**

- `epo.org` Guidelines for Examination pages returned 503/504 or JS-only shells on every attempt (`https://www.epo.org/en/legal/guidelines-epc/2025/b_x.html` and legacy `.../b_x_9_2.htm`). EPO Guidelines text was instead read from the XEPC mirror (`https://xepc.eu/node/b_x_9_2_1`, `https://xepc.eu/node/r62`, `https://xepc.eu/node/b_x_2`), which reproduces the Guidelines verbatim with EPO section references. Claims sourced this way are marked *(via XEPC mirror)*.
- `ecfr.gov` redirected to an unblock page; 37 CFR 1.111 text was read from Cornell LII instead.
- The old WIPO form URLs (`wipo.int/export/sites/www/pct/en/forms/...`) are dead (404). The current form PDFs live under `wipo.int/documents/d/pct-system/...` and were read in full.
- AIPLA freedom-to-operate / due-diligence guidance is member-gated and was **not** fetched. FTO structure claims that rest only on practitioner convention are marked unverified.

---

## 1. `prior-art-report`

### (a) Authoritative structure

**Owner: PCT International Search Report, Form PCT/ISA/210 (July 2022)** — [wipo.int/documents/d/pct-system/docs-en-forms-isa-isa210.pdf](https://www.wipo.int/documents/d/pct-system/docs-en-forms-isa-isa210.pdf); how to fill it out: PCT ISPE Guidelines ch. 16 — [wipo.int/pct/en/texts/ispe/16_22_85.html](https://www.wipo.int/pct/en/texts/ispe/16_22_85.html). Read directly from the form PDF:

1. **First sheet** — application identity block (application no., filing date, **(earliest) priority date**), basis of the report (language, Rule 91 rectifications, sequence listings → Box I), unsearchable claims (Box II), lack of unity (Box III), title/abstract/figure approval (Box IV).
2. **Second sheet A. CLASSIFICATION OF SUBJECT MATTER** — IPC (or national classification + IPC).
3. **Second sheet B. FIELDS SEARCHED** — minimum documentation (classification symbols), documentation beyond the minimum, and "Electronic database consulted during the international search (name of database and, where practicable, search terms used)".
4. **Second sheet C. DOCUMENTS CONSIDERED TO BE RELEVANT** — a three-column table: `Category* | Citation of document, with indication, where appropriate, of the relevant passages | Relevant to claim No.`
5. **Category legend** (quoted from the form): "X" — "document of particular relevance; the claimed invention cannot be considered novel or cannot be considered to involve an inventive step when the document is taken alone"; "Y" — "…cannot be considered to involve an inventive step when the document is combined with one or more other such documents, such combination being obvious to a person skilled in the art"; "A" — "document defining the general state of the art which is not considered to be of particular relevance"; plus "D" (cited by applicant), "E" (earlier application/patent published on/after the filing date), "L" (doubts on priority / establishes publication date), "O" (oral disclosure, use, exhibition), "P" (published between priority date and filing date), "T" (later document cited to understand the principle), "&" (member of the same patent family).
6. **Patent family annex** — "Information on patent family members" sheet.
7. The ISR is accompanied by the **Written Opinion, Form PCT/ISA/237** (structure in §6 below).

**EPO side:** the extended European search report (EESR) = European search report **plus** an opinion "on whether the application and the invention to which it relates seem to meet the requirements of this Convention" (Rule 62(1) EPC, via XEPC mirror: [xepc.eu/node/r62](https://xepc.eu/node/r62); canonical owner: EPO Guidelines B‑X / Rule 62 EPC at epo.org, unreachable at time of writing). The EPO uses the same X/Y category definitions (Guidelines B‑X 9.2.1, via [xepc.eu/node/b_x_9_2_1](https://xepc.eu/node/b_x_9_2_1)).

### (b) What our template gets right

- "Search Strategy" (databases, classification codes, keyword sets, date ranges) matches ISR section B "Fields searched" including its "search terms used" requirement.
- "Findings" then "Relevance Assessment" mirrors the ISR→written-opinion sequence.
- Matter/date/prepared-by metadata block is a reasonable stand-in for the form's identity block.

### (c) Missing / misordered, ranked by practitioner impact

1. **No X/Y/A citation-category convention.** The category letter per citation is the single highest-information element of a professional search report — it tells the reader instantly which references kill novelty alone (X) vs. in combination (Y) vs. background (A). The Findings section should instruct the model to emit the ISR-style table `| Category | Citation (relevant passages) | Relevant to claim No. |` and the report should carry the category legend. (Form PCT/ISA/210 section C + legend, above. Note: the sibling recipes `recipe-prior-art-search` / `recipe-invalidity-analysis` already speak X/Y/A, so this also aligns the report with the rest of the product.)
2. **No per-citation claim mapping.** "Relevant to claim No." is a mandatory ISR column; our free-text Findings do not ask for it.
3. **No relevant-date / priority-date field.** Categories P and E are defined relative to the priority date; the ISR first sheet carries "(Earliest) Priority Date". Add a metadata row so the cutoff the search was run against is explicit.
4. **No classification of subject matter.** ISR section A records IPC/CPC for the invention itself (distinct from the codes searched). One metadata row suffices.
5. **US-only relevance vocabulary.** "§102/§103" in the Relevance Assessment stub is USPTO-specific; the international forms speak novelty / inventive step / industrial applicability (ISA/237 Box V). Wording like "novelty (§102 / Art. 54 EPC) and inventive step (§103 / Art. 56 EPC)" would match both regimes.
6. **No patent family annex.** Nice-to-have; the ISR appends family members of cited documents.

---

## 2. `fto-memo`

### (a) Authoritative structure

There is **no official form** for an FTO memorandum. The most authoritative public guidance is WIPO's "IP and Business: Launching a New Product: Freedom to Operate" — [wipo.int/en/web/wipo-magazine/articles/ip-and-business-launching-a-new-product-freedom-to-operate-34956](https://www.wipo.int/en/web/wipo-magazine/articles/ip-and-business-launching-a-new-product-freedom-to-operate-34956). Verified points from that article:

- An FTO analysis "invariably begins by searching patent literature for issued or pending patents, and obtaining a legal opinion as to whether a product, process or service may be considered to infringe any patent(s) owned by others".
- "The claims section in a patent document determines the scope of the patent" — the analysis is claim-driven, not abstract-driven.
- Risk-mitigation options it names: licensing, cross-licensing, inventing around (design-around), patent pools.
- FTO is territorial and time-bound (patents expire; jurisdictions differ) — the article frames FTO per market.

AIPLA practitioner guidance was not reachable (member-gated); any structure attributed to it here would be invented, so none is. Items below marked *(convention — unverified)* rest on common practitioner practice only.

### (b) What our template gets right

- The five-part shape (product description → analysis → blocking references & risk → recommendations → assumptions & limitations) covers everything the WIPO article requires, including the risk-mitigation menu ("design-around options, licensing, invalidity positions") and a scope-of-search limitation section.
- A dedicated "Jurisdiction(s)" metadata row matches FTO's territorial nature.

### (c) Missing / misordered, ranked

1. **No legal-status / expiry treatment for blocking references.** FTO turns on whether each candidate claim is *in force* in the target jurisdiction and when it expires. Section 3's stub says "in-force claims" but nothing asks for per-reference legal status, remaining term, or lapsed/expired disposition — the cheapest way a reference drops out of an FTO. Add to the §3 stub: "for each reference: jurisdiction, legal status, and expiry/remaining term." (Territoriality/term: WIPO article above.)
2. **Analysis is unstructured; the source says claims control.** The §2 stub should direct claim-level treatment of the closest references (independent-claim element vs. product-feature mapping for high-risk hits), since "the claims section … determines the scope". 
3. **No search-date / publication-lag caveat.** Pending applications are invisible for ~18 months; a compliant Assumptions section should state the search cutoff date and the unpublished-application gap. The WIPO article flags pending applications as part of the search; the 18-month caveat itself is *(convention — unverified)*.
4. **No up-front conclusion/opinion summary.** Practitioner FTO memos open with the bottom-line risk conclusion *(convention — unverified)*. Low cost, but not source-mandated.

---

## 3. `office-action-scaffold`

### (a) Authoritative structure

**Owner: 37 CFR 1.111** — [law.cornell.edu/cfr/text/37/1.111](https://www.law.cornell.edu/cfr/text/37/1.111) (ecfr.gov blocked) — and **MPEP § 714** (amendment format under 37 CFR 1.121) — [uspto.gov/web/offices/pac/mpep/s714.html](https://www.uspto.gov/web/offices/pac/mpep/s714.html). Verified requirements:

- 1.111(b): the reply must "distinctly and specifically point[] out the supposed errors in the examiner's action" and must "reply to every ground of objection and rejection in the prior Office action"; general allegations of patentability do not count; the reply must be a bona fide attempt to advance the application.
- 1.111(c): when amending, the applicant must "clearly point out the patentable novelty" over the cited art and "show how the amendments avoid such references or objections".
- MPEP 714 / 37 CFR 1.121: claim amendments require a **complete listing of all claims ever presented**, each with a status identifier — (Original), (Currently amended), (Canceled), (Withdrawn), (Previously presented), (New), (Not entered) — with underline/strike-through markings; and **each section of the reply (amendments, remarks) must begin on a separate sheet**.
- Filed replies conventionally order the document: identification/caption → Amendments to the Claims (complete listing) → Remarks/Arguments *(ordering as such is convention; the separate-sheet sectioning is MPEP-mandated)*.

### (b) What our template gets right

- The metadata block (Application No., Examiner, Art Unit, Mailing Date, Response Due Date) matches the caption data of a real reply.
- Summary of Rejections → Arguments → Amendments → Conclusion covers all substantive pieces 1.111 requires.

### (c) Missing / misordered, ranked

1. **Amendments come after Arguments; real replies put "Amendments to the Claims" before "Remarks".** Since each part must begin on its own sheet (MPEP 714 / 37 CFR 1.121) and examiners read the claim listing first, swap §2 and §3: `Summary of Rejections → Claim Amendments → Remarks/Arguments → Conclusion`.
2. **The amendments stub misses the complete-listing rule.** "Proposed amendments in marked-up form" is not compliant practice: 37 CFR 1.121(c) requires a listing of **all** claims with status identifiers, amended ones marked up. The stub should say so — a scaffold that invites listing only the amended claims teaches a defective reply.
3. **No "answer every ground" instruction.** 1.111(b) makes completeness mandatory; the Arguments stub should direct one response per listed ground (rejections *and* objections), in the order the examiner raised them.
4. **No "show how the amendments avoid the references" hook (1.111(c)).** One sentence in the Arguments or Amendments stub covers it.
5. Metadata nits: a Confirmation No. row is customary on USPTO papers *(convention — unverified)*.

---

## 4. `invalidity-claim-chart`

### (a) Authoritative structure

**Owner: N.D. Cal. Patent Local Rule 3-3 (Invalidity Contentions)** — [cand.uscourts.gov/rules/patent-local-rules/](https://www.cand.uscourts.gov/rules/patent-local-rules/). Verified requirements:

- 3-3(a): identify **each item of prior art** with full qualification — patents by number/country/date; publications by title, date, author; prior sale/public use by item, date, and parties; §102(f)/(g) circumstances.
- 3-3(b): state **whether each item anticipates or renders obvious**, and for obviousness give "an explanation of why the prior art renders the asserted claim obvious, including an identification of any combinations of prior art showing obviousness".
- 3-3(c): "a chart identifying specifically **where and how** in each alleged item of prior art each limitation of each asserted claim is found", including the structure/act/material for §112(6)/(f) limitations.
- 3-3(d): any grounds under §101, §112(1) (enablement / written description), §112(2) (indefiniteness).

### (b) What our template gets right

- The element-by-element chart with one row per claim element and one column per reference is exactly the 3-3(c) shape, and the X/§102 vs Y/§103 tagging in the chart guidance matches ISR category practice.
- "Basis Summary" (statute, claims affected, references/combinations) covers 3-3(b)'s anticipation-vs-obviousness statement.
- Verbatim claim language as an appendix is good chart hygiene.

### (c) Missing / misordered, ranked

1. **No motivation-to-combine requirement for obviousness combinations.** 3-3(b) explicitly demands an *explanation of why* the combination renders the claim obvious. The Basis Summary stub lists statute + references but never asks for the reason to combine — the part opposing counsel attacks first. Add it to the §3 stub (and to the chart-cell guidance for Y-type cells).
2. **No prior-art qualification section.** 3-3(a) requires each reference to be identified with the facts that qualify it as prior art (publication date vs. the challenged patent's priority date; sale/use circumstances). The Overview stub asks only to "identify… the prior art reference(s)". Add a "Prior Art References & Dates" section or extend the Overview stub with per-reference date/qualification.
3. **No §101/§112 grounds slot.** 3-3(d) makes eligibility/indefiniteness/enablement part of a complete invalidity contention. An optional "Other Grounds (§101/§112)" section closes the gap.
4. **Pinpoint citations.** 3-3(c)'s "specifically where" means column/line/paragraph/figure cites, not paraphrase alone; strengthen the chart-cell guidance to require pinpoint cites.
5. **§112(f) structure mapping** for means-plus-function elements (3-3(c) last clause) — a one-line addition to the chart guidance.

---

## 5. `eou-infringement-chart`

### (a) Authoritative structure

**Owner: N.D. Cal. Patent Local Rule 3-1 (Disclosure of Asserted Claims and Infringement Contentions)** — [cand.uscourts.gov/rules/patent-local-rules/](https://www.cand.uscourts.gov/rules/patent-local-rules/). Verified requirements:

- 3-1(a): each asserted claim **and the applicable subsection(s) of 35 U.S.C. § 271**.
- 3-1(b): each Accused Instrumentality identified "by name or model number" — separately for each product/process.
- 3-1(c): "a chart identifying specifically where and how each limitation of each asserted claim is found within each Accused Instrumentality", incl. §112(6)/(f) structure/act/material.
- 3-1(d): for indirect infringement, the acts of the direct infringer and the accused party's inducing/contributing acts.
- 3-1(e): "whether each limitation of each asserted claim is alleged to be literally present or present under the doctrine of equivalents" — **per limitation**.
- 3-1(f): priority-date contentions; 3-1(g) own practicing products; 3-1(h) damages timing; 3-1(i) willfulness basis.

### (b) What our template gets right

- The chart `| Claim Element | Accused Product Feature | Supporting Evidence |` is the 3-1(c) shape, and the evidence-citation guidance (specifications, teardowns, marketing materials) is exactly EoU practice.
- "Infringement Theory" (literal vs. DOE) and "Evidentiary Sources" are the right companions.

### (c) Missing / misordered, ranked

1. **Literal vs. DOE is per-limitation under 3-1(e), but our template treats it as a document-level narrative (§3).** Move it into the chart: either a fourth column (`Literal / DOE`) or a required tag in each row. The narrative section can stay for the DOE rationale of the non-literal elements.
2. **Accused-instrumentality specificity.** 3-1(b) wants each product named by model number and charted separately; the guidance should say "one chart per accused product/version, identified by name and model number".
3. **No § 271 subsection / direct-vs-indirect slot.** 3-1(a)/(d): the Overview stub should ask which §271 theory applies and, for inducement/contributory theories, who the direct infringer is.
4. **§112(f) mapping** (3-1(c)): identify the accused structure performing each means-plus-function element.
5. 3-1(f)–(i) items (priority date, own products, damages window, willfulness) are litigation-contention extras; for a licensing-oriented EoU chart they can stay out — no change recommended.

---

## 6. `patentability-opinion`

### (a) Authoritative structure

**Closest official form: Written Opinion of the ISA, Form PCT/ISA/237 (July 2022)** — [wipo.int/documents/d/pct-system/docs-en-forms-isa-isa237.pdf](https://www.wipo.int/documents/d/pct-system/docs-en-forms-isa-isa237.pdf). Read directly from the form, the opinion consists of:

- Cover sheet + **Box I** Basis of the opinion; **Box II** Priority (validity of the priority claim, and which "relevant date" the opinion assumes); **Box III** Non-establishment of opinion (unclear/unsupported claims); **Box IV** Lack of unity.
- **Box V — "Reasoned statement … with regard to novelty, inventive step and industrial applicability; citations and explanations supporting such statement"** — item 1 is a **per-claim YES/NO grid**: `Novelty (N): Claims … YES / Claims … NO; Inventive step (IS): Claims … YES / Claims … NO; Industrial applicability (IA): Claims … YES / Claims … NO`; item 2 is "Citations and explanations".
- **Box VI** Certain documents cited (E/P-type documents with dates); **Box VII** Certain defects; **Box VIII** Observations on clarity/support.

There is no official form for a private pre-filing patentability opinion; the ISA/237 boxes are the recognized official analogue (as the task brief assumes). Private-opinion conventions beyond ISA/237 are *(convention — unverified)*.

### (b) What our template gets right

- Invention Summary → Prior Art Discussed → Novelty & Inventive-Step Analysis → Conclusion/Risk is a sound narrative arc, and it already uses the international novelty/inventive-step vocabulary (not just §102/§103).
- "Prior Art Discussed" with publication numbers matches Box V item 2's citation duty.

### (c) Missing / misordered, ranked

1. **No per-claim conclusion grid.** Box V's defining feature is claim-level granularity: which claims are novel, which lack inventive step. Our §3 invites one blended narrative. Add guidance (or a small table) for a per-claim/per-claim-group N and IS verdict, each tied to its citations — this is what makes the opinion actionable for claim redrafting.
2. **No industrial-applicability / eligibility screen.** Box V includes IA; the US analogue is §101 eligibility/utility. One row in the per-claim grid, or one sentence in the Conclusion stub.
3. **No claim-clarity / support observations slot** (Box VIII analogue): claim defects found during the analysis need a home; an optional subsection under Conclusion suffices.
4. **No relevant-date statement** (Box II analogue): the opinion should state which priority/filing date the art was measured against. Metadata row.

---

## 7. `landscape-report`

### (a) Authoritative structure

**Owner: WIPO "Guidelines for Preparing Patent Landscape Reports" (Pub. No. 946, Trippe/WIPO 2015)** — PDF: [wipo.int/edocs/pubdocs/en/wipo_pub_946.pdf](http://www.wipo.int/edocs/pubdocs/en/wipo_pub_946.pdf); publication page: [wipo.int/publications/en/details.jsp?id=3938](https://www.wipo.int/publications/en/details.jsp?id=3938). Section 8.7.1 "Writing the Report" (read directly from the PDF) says a PLR "should … ideally include the following sections":

1. **Executive Summary** — "may be the only section that is read in any detail, so it should include all of the major findings".
2. Introduction (how the report is organized).
3. Background on the Technology (incl. definitions of the subcategories used).
4. Background on Patents (patent-information primer for non-specialist readers).
5. Justifications for Creating the PLR (objectives/goals — "the lens through which the reader should consider the remainder").
6. Economics Associated with the Topic.
7. **Methodology**, with four mandatory strands: Search Strategy (§8.2), Data Preprocessing (§8.3 — cleanup/grouping, family reduction, year-field choice, category generation), Analysis Methods (§§8.4–8.6), and **Issues and Limitations** ("there are always assumptions made, and disclosures that should be shared").
8. Analysis section (charts, tables, commentary).
9. Additional Resources.
10. **Conclusions** — "a summary of the major findings and insights, along with recommendations for action, associated with the objectives".

### (b) What our template gets right

- "Scope & Methodology" (keywords, CPC/IPC, jurisdictions, date range, data source) covers the Search Strategy strand well.
- "Filing Trends, Assignees & Classification Breakdown" matches the guidelines' core statistical analyses (§8.4: families, filings per year, top applicants, technology categories).
- White-space observations map to the analysis/insight layer.

### (c) Missing / misordered, ranked

1. **No Executive Summary.** WIPO's strongest single statement about PLR structure ("may be the only section that is read"). Add it as section 1.
2. **No Issues & Limitations.** One of the four mandatory methodology strands; a landscape without stated caveats (family-reduction method, year field, 18-month publication lag, name-normalization limits) invites over-reading of the numbers. Add as a subsection of Scope & Methodology or as a closing section.
3. **No Conclusions/recommendations distinct from white-space.** WIPO separates data-driven observations (analysis) from "recommendations for action" tied to the objectives. Rename/extend §3 or add a short §4 "Conclusions & Recommendations".
4. **No objectives statement.** "Justifications" — the question the landscape answers — is the reading lens; a single stub line in §1 ("state the objective/decision this report supports") covers it.
5. **Data preprocessing note** (family reduction, applicant-name normalization) — one line added to the §1 stub; matters for reproducibility.
6. Background-on-technology/patents and Economics sections are audience-dependent padding for our use case — no change recommended.

---

## 8. `portfolio-due-diligence-memo`

### (a) Authoritative structure

**Owner (practitioner checklist): NYIPLA / L. M. Brownlee, "Intellectual Property Due Diligence Checklist" (IP Due Diligence in Corp. Transactions, Form 16)** — [nyipla.org PDF](https://www.nyipla.org/images/nyipla/Committees/IntellectualPropertyDueDiligenceChecklist(IPDueDiligenceinCorp.Transactions).pdf) (read in full). Patent-relevant content, verified from the document:

- **General:** personnel whose work touches IP (employee/contractor agreements, hiring/exit policies); **loan/financing agreements and all documents granting IP as collateral, security or capital contribution**; searches of USPTO/foreign registries for agreements and records; three-year IP legal budget.
- **Patents (§3):** (a) all issued/pending/abandoned/rejected patents incl. reissues, continuations, divisionals, CIPs + patentable inventions, with inventors and key dates; (b) **entire file wrapper (prosecution history)**; (c)–(d) invention disclosures and disclosure policies; (e), (g) validity/patentability/infringement **searches and opinions** in the target's files (own and third-party art); (f) registry searches for the target's patents **and any potentially dominating or infringing patents**; (h)–(i) **publications, speaking engagements, and trade-show demonstrations** (public-disclosure/bar-date exposure); (j)–(k) **all agreements for the target's use of third-party patents and third-party use of the target's patents** (in-bound and out-bound licenses); (l) all **disputes** (defined to include oppositions, reexam, IPR/PGR, ITC investigations, royalty demands) with parties, dates, disposition.

Secondary (context, not structure): WIPO IP-audit and due-diligence materials — [wipo.int/en/web/business/ip-audit](https://www.wipo.int/en/web/business/ip-audit), [wipo.int "IP Due Diligence Readiness"](https://www.wipo.int/export/sites/www/sme/en/documents/pdf/due_diligence_readiness.pdf) (latter not fetched — listed for reference only, **unverified**).

### (b) What our template gets right

- Portfolio Overview (assets/families/jurisdictions), Legal-Status Summary (incl. maintenance-fee standing), Encumbrances & Risks (liens, licenses, litigation, inventorship/ownership), and Valuation-Relevant Observations together cover most of the checklist's patent section; maintenance-fee standing and remaining term are checklist-aligned and practitioner-critical.

### (c) Missing / misordered, ranked

1. **Ownership / chain of title deserves its own section.** The checklist's center of gravity is proving the target actually owns what it lists: recorded assignments, employee/consultant assignment agreements, inventorship correctness, and security interests recorded against the patents (General §2.i, Patents §3.a–b). Our template compresses this into a clause inside "Encumbrances and Risks". Split out "§ Ownership & Chain of Title" — the first thing a deal lawyer checks.
2. **License/agreement inventory (in-bound and out-bound) as a distinct item.** Checklist §3.j–k treats agreements as their own category, not merely an encumbrance: out-bound exclusive licenses cap value; in-bound licenses may not survive the transaction. Extend the Encumbrances stub or add a section.
3. **Prosecution-history review.** Checklist §3.b requires the entire file wrapper — where terminal disclaimers, prosecution disclaimers, and estoppel live. One clause in Key Asset Analysis stub: "note file-wrapper red flags (terminal disclaimers, narrowing amendments, disclaimers)".
4. **Prior searches & opinions in the target's files** (§3.e, g): existing validity/FTO/infringement opinions are both an asset and a risk record (willfulness). One clause in Encumbrances & Risks.
5. **Public-disclosure / bar-date exposure** (§3.h–i): publications and trade-show demos that predate filings. Minor; one clause.
6. **Disputes definition breadth**: the checklist's "Disputes" includes oppositions, reexams, IPR/PGR and royalty demands, not just litigation — widen the stub's "litigation history" wording.

---

## Prioritized change list (across all 8 templates)

1. **`prior-art-report`:** make Findings an ISR-style citation table with the X/Y/A category legend and a "relevant to claim No." column (Form PCT/ISA/210, section C + legend).
2. **`office-action-scaffold`:** put Claim Amendments before Remarks and require a complete claim listing with status identifiers; instruct answering every ground (37 CFR 1.111(b)/(c), 1.121; MPEP 714).
3. **`invalidity-claim-chart`:** require a motivation-to-combine explanation for every obviousness combination, and per-reference prior-art qualification dates (N.D. Cal. Patent L.R. 3-3(a)–(b)).
4. **`landscape-report`:** add an Executive Summary section and an Issues & Limitations strand to the methodology (WIPO Pub 946, §8.7.1).
5. **`eou-infringement-chart` + `patentability-opinion`:** tag literal vs. doctrine-of-equivalents per claim element inside the chart (Patent L.R. 3-1(e)); add a per-claim novelty/inventive-step verdict grid modeled on ISA/237 Box V.
