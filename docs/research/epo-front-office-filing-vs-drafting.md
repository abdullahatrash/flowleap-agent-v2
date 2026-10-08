# EPO Front Office filing vs FlowLeap Application Drafting

**Date:** 2026-10-08
**Question:** What does the EPO Front Office filing flow require of a European patent
application, and which of that knowledge should shape Application Drafting (PRD 0020,
ADR 0012)?
**Source tree:** `/Users/abdullahatrash/epo` (EPO proprietary code, read only). All EPO paths
below are relative to `~/epo/`. No EPO code or configuration is copied into this note or into
the FlowLeap repository. This note names rules and file locations only.
**FlowLeap files read:** `docs/prd/0020-application-drafting.md`,
`docs/adr/0012-traced-application-drafting.md`,
`extensions/copilot/assets/skills/application-drafting/SKILL.md`,
`extensions/copilot/assets/skills/application-drafting/references/epo-section-order.md`,
`extensions/copilot/src/extension/tools/common/drafting/*.ts`,
`extensions/copilot/src/extension/tools/vscode-node/draftDocx.ts`.

Marking convention: a sentence that starts with "Inference:" is not stated in the code. A
sentence that names an EPC rule without an EPO path is public law, not a finding from the code.

## 1. Executive summary

1. The Front Office (FO) EP 1001 flow checks the **container**, not the **content**. It never reads the text of the description, claims or abstract.
2. Technical documents for EP 1001 are **PDF only**: description, claims, abstract, drawings, or one combined PDF with declared page ranges (`fo-configuration/procedures/EP1001/config/attachmentTypes.json`).
3. The file service rejects a PDF that is encrypted, larger than A4 (with tolerance), has non-embedded fonts, embedded files, JavaScript or active content (`file-service/.../validation/pdf/PdfAnnexfContentValidator.java`).
4. The applicant **declares** the number of claims, the number of drawings and the figure to publish with the abstract. The FO does not count them from the document (`frontend/src/components/draft/attachments/services/constants.js:82`).
5. The only hard content minimum is "at least a description" (`fo-configuration/locales/en/resource.json:2030`). Claims, abstract and drawings can follow later.
6. The Annex F package wraps each PDF as `doc-page` references in `application-body.xml`. The FO never emits full-text XML for claims or description (`fo-configuration/procedures/common/annexf/xslt/application-body-xml-v1-7.xslt:334`).
7. FlowLeap validators already go further than the FO on content (antecedent basis, numbering, Rule 43(2), abstract length, numerals). The gaps are on the **filing container** and a few public EPC content rules (one-sentence claims, reference signs in parentheses, Rule 48 matter, Rule 43(6), page-fee count).
8. `upc-drafter` is a 246-line CKEditor demo for Unified Patent Court pleadings. It has no patent-application logic. Nothing to learn for drafting except "rich text in, HTML out".
9. The UPC and PMAC configurations are court and mediation filings, not patent applications. They are out of scope for Application Drafting.
10. Top recommendation: export **per-document-type PDFs** (A4, embedded fonts, no active content) plus a filing manifest that states claims count, drawings count, page counts and figure for the abstract. Do not build an Annex F XML package or a request form.

## 2. The EP filing flow as the Front Office implements it

### 2.1 Which product this is

- The tree is the EPO "ITC Front Office", a filing portal that the EPO builds for national
  offices. The EP 1001 header names the software `ITC Front Office`
  (`fo-configuration/procedures/EP1001/config/config.yml`, key `header.software-name`).
- EP 1001 packages go from an initial national office to the EPO: `transfer-service.initial-office: "GR"`,
  `destination-office: "EP"`, `form-type: "EP1001E2KRENA"` (same file).
- Inference: this FO is the national-office route for EP filings (Art. 75(1)(b) EPC). The
  EPO's own Online Filing 2.0 may apply more checks. The FO rules are a **floor**, not the full
  set of EPO formalities.

### 2.2 Steps

The user guide describes the wizard for a submission
(`front-office-docs/docs/modules/fo-user-guide/pages/submissions/drafting.adoc`):

1. Select the submission type (procedure). EP 1001 is procedure `EP1001`, category
   `epo-procedure`, type `EUROPEAN` (`fo-configuration/config-default.yml:198-220`).
2. Basic filing info: user reference and title of invention.
3. Parties: applicants, representatives, inventors.
4. Attachments: "at least one document is added: Description".
5. Fees.
6. Summary (verify).
7. Send to sign, then sign, pay, send (`.../submissions/signing.adoc`, `paying.adoc`, `sending.adoc`).

The EP 1001 UI schema composes these sections from common definitions: basic filing info,
user reference, applicants, inventors, representatives, fees, receipt
(`fo-configuration/procedures/EP1001/form/uiSchema.json`, the `$ref` entries to
`procedures/common/form/uischema/*.json`).

### 2.3 Request fields

| Field | Constraint | Evidence |
|---|---|---|
| User reference | at most 25 characters, restricted character set; mandatory to save a draft | `fo-configuration/procedures/common/form/basic-filing.jsonschema:5-12`; `fo-configuration/locales/en/resource.json:1580` |
| Filing language | en, fr, de (default en) | `basic-filing.jsonschema:14-30` |
| Receiving-office languages for EP | EN, DE, NL listed | `fo-configuration/procedures/EP1001/config/receivingOfficesLanguages.json` |
| Title of invention | at most 512 characters | `basic-filing.jsonschema:32-38` |
| Petition text | fixed: grant and examination under Art. 94 requested | `EP1001/config/config.yml`, key `xslt.params.petition` |
| Priority claims | list, mapped to `ep-priority-claim` | `fo-configuration/procedures/EP1001/annexf/xslt/request-xml.xslt:76`, `:336-372` |
| Figure to publish with the abstract | at most 4 characters, from the abstract attachment | `request-xml.xslt:86-126`; `submission-service/.../combinedfile/AttachmentMetaInput.java` (`figureToBePublished`, size 0..4) |
| Designated and extension/validation states | `ep-designated-states`, `extension-states`, `validation-states` | element list of `request-xml.xslt` |
| Biological material | depositary, accession number | `request-xml.xslt` (`ep-biological-material`, `bio-accno`) |

Inference: the request data (EP 1001 form content) is not part of the application documents.
A drafting tool does not need to produce it. It can only help by handing over the title and
the figure for the abstract.

### 2.4 Applicant, inventor and representative data

- Applicant: natural person or legal entity, with ownership percentage, "applicant is
  inventor" flag and a waiver flag (`fo-configuration/procedures/common/form/parties.jsonschema:54-190`).
- Representative roles: agent or representative, natural person or legal entity, or employee
  (`parties.jsonschema:196-230`).
- Inventor: first name and last name at most 64 characters each, optional nationality,
  identification number at most 12, "inventor is deceased", declaration of rights
  (employer, successor, agreement, other), and waiver of mention
  (`parties.jsonschema:368-460`).
- The FO generates the designation of inventor as a separate PDF (`invt-1.pdf`, Annex F code
  `F1002`) from the inventor data (`fo-configuration/procedures/EP1001/annexf/package-manifest.yml`, key `blob.inventor`).
- Public law: Rule 19 EPC (designation of inventor), Rule 20 EPC (waiver of mention).

Inference: FlowLeap's Working Record already records who conceived what (ADR 0012, decision 6).
That record is the evidence base for the declaration of rights. It is not the declaration.

### 2.5 Document types and their rules

EP 1001 attachment types (`fo-configuration/procedures/EP1001/config/attachmentTypes.json`):

| Type | System file name | Formats | Notes | Line |
|---|---|---|---|---|
| DESCRIPTION | SPECEPO | pdf | technical, distinct type | 4 |
| CLAIMS | SPECEPO | pdf | technical, distinct type | 19 |
| ABSTRACT | SPECEPO | pdf | technical, distinct type | 34 |
| DRAWINGS | SPECEPO | pdf | technical, distinct type | 49 |
| COMBINED | SPECEPO | pdf | one PDF with page ranges per part | 64 |
| DESCRIPTION_NON_EPO_LANGUAGE | SPECNONEPO | pdf | Art. 14(2) filing in another language | 198 |
| PRE_CONVERSION | OLF-ARCHIVE | zip | source files before PDF conversion | 213 |
| SEQ_LIST | SEQLZIP26 / SEQLXML26 | zip / xml | at most 50 MB, one file | 300, 317 |
| BIO_MATERIAL, BIO_AUTH, BIO_WAIVER | BIOM* | pdf, doc, docx, jpg, png | the only types that accept DOCX | (file) |
| Translations, priority documents, authorisations, inventor waiver, other | various | pdf | additional | (file) |

Naming: the submission service renames each upload to its system file name, with an index
when there is more than one (for example `SPECEPO.pdf`, then `SPECEPO_2.pdf`)
(`submission-service/src/main/java/org/epo/itc/frontoffice/submission/attachment/AttachmentServiceImpl.java:519-548`).
Inference: the user's own file names do not matter for filing.

Size limits: total upload per submission 500 MB by default
(`fo-configuration/services/common/application.yml:48`); one file 512 MB by default (`:72`);
sequence listing 50 MB (`attachmentTypes.json:300-330`).

### 2.6 Combined PDF and declared counts

- For each technical part the user declares the first and last page in a combined PDF. The UI
  rejects overlaps, gaps ("Each page should be accounted for.") and from > to
  (`frontend/src/components/draft/attachments/hooks/useAttachmentsValidations.js`;
  `fo-configuration/locales/en/resource.json:2074`).
- The submission service compares the last declared page with the real PDF page count and
  rejects a mismatch both ways (`AttachmentServiceImpl.java:421-433`;
  `resource.json:1040`).
- For technical attachments the user enters `numberOfClaims`, `numberOfDrawings` and
  `figureToBePublished` (`frontend/src/components/draft/attachments/services/constants.js:82`;
  `.../uploader/meta/useAttachmentMetaFields.js:46-66`). Range 1..999999
  (`AttachmentMetaInput.java`).
- The request XML check list carries `page-count`, first and last page, and
  `number-of-claims` per document (`EP1001/annexf/xslt/request-xml.xslt:375-560`, template
  `checklistItem`).
- Nothing in the FO counts claims from the text. Inference: a wrong declared claim count
  passes the FO and is found later by the EPO formalities officer.

### 2.7 Client-side vs service-side validation

| Check | Where |
|---|---|
| Field length, pattern, required fields | JSON schema in the browser (`procedures/common/form/*.jsonschema`) |
| Page range overlap, gaps, order | browser (`useAttachmentsValidations.js`) |
| File extension and MIME type per type | browser and `submission-service/.../attachment/validation/AttachmentValidator.java` |
| One attachment per distinct type, no duplicate file name | `AttachmentValidator.java` |
| Declared pages vs real PDF pages | `AttachmentServiceImpl.java:421-433` |
| Total upload size | `AttachmentServiceImpl.java:508-516` |
| PDF content: encrypted, page size, embedded objects, active content, embedded fonts, JavaScript, unsafe annotations | `file-service/src/main/java/org/epo/itc/frontoffice/file/storage/validation/pdf/PdfAnnexfContentValidator.java` |
| PDF/A conformance (veraPDF), when the PDF_A mode is set | `.../validation/pdf/PdfAContentValidator.java` |
| XML well-formed and DTD-valid (sequence listings) | `.../validation/xml/XMLContentValidator.java` |
| Antivirus scan | `.../validation/FileValidationService.java:42-44` |
| "A description is required" | business rule, message key `submission.attachments.businessrule.description-type-attachment-needed` (`resource.json:2030`) |
| Fees code and amount tamper check | DMN rules (`fo-configuration/procedures/common/rules/README.md`) |

Validation mode: the file service runs the ANNEXF, PDF_A or BASIC validator set, chosen per
request or by a configuration default (`FileValidationService.java:35-46`). Inference: an
installation picks one mode; FlowLeap must target the strictest (ANNEXF plus PDF/A).

PDF page size rule: the page is accepted when the short side is at most 227.0 mm and the long
side at most 312.0 mm, landscape is allowed (`.../validation/pdf/PDFUtils.java:29-30`,
`:81-95`). Fonts: every font must be embedded; the 14 standard PDF fonts (Helvetica, Times,
Courier, Symbol, ZapfDingbats) are tolerated (`PDFUtils.java:111-143`).

### 2.8 Fee-relevant counts

- Fees are configured per installation; the reference file holds demo amounts, with a code
  `003` "claims fee" (`fo-configuration/procedures/common/config/fees.json`).
- The FO does not compute the claims fee or page fee for EP 1001 from the documents. The counts
  it carries are the declared `number-of-claims` and `page-count`
  (`request-xml.xslt`, `checklistItem`).
- Public law: claims fee for each claim over 15 (Rule 45 EPC; higher rate over 50 in the RFees);
  page fee for each page over 35 of description, claims, abstract and drawings (Art. 2(1)
  item 1a RFees; sequence listings do not count). Inference: the attorney needs these two
  numbers before filing; the FO will only echo what the attorney declares.

## 3. Document content rules vs FlowLeap validators

The FO code checks almost no content rule. The table lists the rules a European application
must meet, where the FO touches each (if it does), and what FlowLeap has today. "No EPO code"
means the rule is public EPC law that this FO does not implement.

| Rule | Where in EPO code | In FlowLeap today |
|---|---|---|
| At least a description to get a date of filing (Rule 40(1)(c)) | `resource.json:2030`, `:933` | no (we always draft one; no check needed) |
| Claims numbered consecutively in Arabic numerals (Rule 43(5)) | no EPO code | yes, `checkClaimNumbering` (`claimValidators.ts:39`) |
| One independent claim per category (Rule 43(2)) | no EPO code | yes, `checkEpoOneIndependentPerCategory` (`claimValidators.ts:55`) |
| Dependent claims refer to preceding claims (Rule 43(4)) | no EPO code | yes, `checkDependencyTargets` (`claimValidators.ts:23`) |
| Each claim is one sentence (Guidelines F-IV, 4.1) | no EPO code | no |
| Reference signs in claims placed in parentheses (Rule 43(7)) | no EPO code | partial: numerals are checked against `figures.md`, parentheses are not (`specValidators.ts:142`) |
| Claims do not rely on references to description or drawings, "as shown in Fig. 1" (Rule 43(6)) | no EPO code | no |
| Two-part form where appropriate (Rule 43(1)) | no EPO code | no (skill text only, `epo-section-order.md`) |
| Claim count over 15 is a fee Note (Rule 45) | declared `number-of-claims` only (`request-xml.xslt`) | yes, `checkClaimCount` Note (`claimValidators.ts:245`) |
| Abstract preferably at most 150 words (Rule 47(3)) | no EPO code | yes, but as **Error**; EPC says "preferably" (`specValidators.ts:46-55`) |
| Abstract carries reference signs of main features in parentheses (Rule 47(4)) | no EPO code | no |
| Figure to publish with the abstract named (Rule 47(4)) | `figureToBePublished`, max 4 chars (`AttachmentMetaInput.java`; `request-xml.xslt:86-126`) | no |
| Title short, technical, no fancy names (Rule 41(2)(b), Guidelines A-III, 7) | only max 512 characters (`basic-filing.jsonschema:32-38`) | no |
| Description order (Rule 42(1)) | no EPO check; DTD has the same section names (`common/annexf/dtd/WIPO-1.16/application-body-v1-7.dtd:343`) | yes, skill order and docx section ordering (`draftDocx.ts:75`) |
| Reference signs list section | DTD element `reference-signs-list` (`application-body-v1-7.dtd:387`) | partial: `figures.md` holds it, export does not emit it |
| Citation list section | DTD element `citation-list` (`application-body-v1-7.dtd:350`) | no |
| Prohibited matter: ordre public, disparaging statements, irrelevant matter (Rule 48) | no EPO code | no |
| No added matter after filing (Art. 123(2)) | no EPO code | yes by design: Inventor Questions, source markers (ADR 0012, decisions 1-2) |
| Claims supported by the description (Art. 84) | no EPO code | yes, `checkLiteralBasis` (`claimValidators.ts:225`) |
| Pages A4, margins, 1.5 line spacing, capital letter height at least 0.21 cm (Rule 49(5), (8), (10)) | page size only, with tolerance (`PDFUtils.java:29-30`, `:81-95`) | no (docx export sets no page setup; Inference: the `docx` package default is A4, verify) |
| Pages numbered consecutively, centred top or bottom (Rule 49(6)) | no EPO code; FO only checks the declared page count | no |
| Lines numbered in multiples of five (Rule 49(6), recommended) | no EPO code | no |
| Drawings on separate sheets, no text except keywords, figures numbered "Fig. 1" (Rule 46) | separate DRAWINGS type (`attachmentTypes.json:49`) | partial: figures list and numerals only; drawings are out of scope (PRD non-goal) |
| Every reference sign used in description also in drawings and back (Rule 46(2)(i)) | no EPO code | yes, `checkReferenceNumerals` against `figures.md` (`specValidators.ts:142`) |
| Embedded fonts, no encryption, no active content in PDF | `PdfAnnexfContentValidator.java` | no (we do not export PDF) |
| Sequence listing in WIPO ST.26 XML when sequences are disclosed (Rule 30) | `SEQLXML26` type, DTD `procedures/common/dtd/ST26SequenceListing_V1_3.dtd` | no |
| Documents in en, fr or de, or translation within 2 months (Art. 14(2), Rule 6(1)) | `basic-filing.jsonschema:14-30`; `DESCRIPTION_NON_EPO_LANGUAGE` (`attachmentTypes.json:198`) | no (implicit English) |

Summary of the gap: four claim and abstract rules are cheap pure-code checks (one sentence,
parentheses around reference signs, no "as shown in Fig." in claims, abstract figure and
reference signs). Rule 48 needs a model review, so it fits the Advisory pass. The rest is the
export container.

## 4. The filing package layout and FlowLeap's export

### 4.1 What the FO builds

The EP 1001 Annex F manifest (`fo-configuration/procedures/EP1001/annexf/package-manifest.yml`)
and workflow config (`fo-configuration/procedures/EP1001/config/config.yml`, key `workflows`):

| File | Annex F code | Made from |
|---|---|---|
| `application-body.xml` (WIPO DTD v1.7) | APPBODYXML | the uploaded PDFs, as `doc-page` references |
| `ep-request.xml` / `ep-request.pdf` | (request) | the form data |
| `feesheetint.pdf` | FEESHEETINT | fee data |
| `invt-1.pdf` | F1002 | inventor data |
| `pkgheader.xml` | HEADERXML | header config |
| `result-filing.xml`, `submission_transfer.xml` | APPMERGEXML, SUBMISSIONTRANSFER | filing state |
| `xmit-receipt.xml`, `receipt.pdf` | RECXML, RECPDF | receipt |
| `WAD.zip` | filing archive | all of the above plus attachments |

`application-body.xml` holds one `doc-page` per part, with the file name, total pages and first
and last page (`fo-configuration/procedures/common/annexf/xslt/application-body-xml-v1-7.xslt:150-206`, `:334-362`).
The DTD also allows full-text claims (`claim`, `claim-text`, `claim-ref`) and full-text
description sections (`application-body-v1-7.dtd:214-512`), but this FO never produces them.

The package is signed by an external signing service (`config.yml`, key
`execution.signing: EXTERNAL_PACKAGE`). Inference: no third-party tool can produce a valid
`WAD.zip`; the signature, receipt and transfer files belong to the office software.

### 4.2 What FlowLeap's export does today

- `buildDraftDocx` writes one `.docx` with all sections in the office order, Claims and
  Abstract on new pages, each claim one paragraph, markers and Inventor Questions removed
  (`extensions/copilot/src/extension/tools/vscode-node/draftDocx.ts:131-159`).
- It sets no page size, margins, line spacing, page numbers or line numbers. It writes one
  section only. It does not export drawings or a reference signs list.

### 4.3 What "filing-ready" would need

The FO accepts only PDF for technical documents. A DOCX is never filed through this FO.
Inference: attorneys convert to PDF in Word or in the EPO's own tools; a DOCX from us is an
input to their final edit, which matches ADR 0012 decision 9.

To make the attorney's last step short, FlowLeap could add:

1. **One file per document type**: description, claims, abstract (and drawings, which the
   user supplies). The FO has distinct types with `needDistinctTypes: true`
   (`attachmentTypes.json:4-75`). A combined PDF works too, but then the attorney must type
   page ranges by hand (`useAttachmentsValidations.js`).
2. **Rule 49 page setup** in the DOCX: A4, margins (top 2 cm, left 2.5 cm, right 2 cm,
   bottom 2 cm), 1.5 line spacing, a font size that gives a capital height of at least
   0.21 cm, page numbers centred, line numbers every five lines. This is public law; the FO
   only checks the A4 envelope (`PDFUtils.java:29-30`).
3. **Optional PDF export** with embedded fonts and no active content, so the files pass
   `PdfAnnexfContentValidator.java` as uploaded. Effort is high in an Electron extension;
   see recommendation 4.
4. **A filing manifest** (`filing-summary.md` or JSON in the draft folder): title, number of
   claims, number of independent claims, pages per document, total pages for the page fee,
   number of drawing sheets, figure proposed for the abstract, filing language. These are the
   exact values the FO asks the user to declare (`constants.js:82`; `request-xml.xslt`,
   `checklistItem`).
5. **No request-data JSON for applicants and no Annex F XML.** The request is entered in the
   filing software, which owns the parties, fees and signing. The full-text Annex F XML is not
   used by this FO. Both would add surface with no user.

## 5. upc-drafter

- What it is: a Vite + React demo with a CKEditor 5 rich-text editor. `App.tsx` shows the
  text "Hello from UPC drafter" and renders the sanitised HTML below the editor
  (`upc-drafter/src/App.tsx`; `upc-drafter/src/ckeditor.ts`; `upc-drafter/src/RichTextEditor.tsx`).
  The whole `src/` is 246 lines of TypeScript. The README is the Vite template README
  (`upc-drafter/README.md`).
- It has no templates, no document assembly, no validation and no patent logic.
- "UPC" here is the Unified Patent Court case-management system. The sibling configuration
  holds court filings: statement of claim, defence, counterclaim, revocation, opt-out,
  provisional measures (`fo-configuration-upc/procedures/cms*`;
  `upc-knowledge/01-infringement-action.md`). PMAC is a mediation and arbitration centre
  (`fo-configuration-pmac/procedures/pmac*`).
- What to learn: very little for Application Drafting. Inference: the EPO stack considered a
  rich-text editor for pleadings, and chose HTML through DOMPurify as the storage format. Our
  Markdown-in-workspace choice (ADR 0012, decision 9) is simpler and diff-friendly, and there
  is no reason to change it.
- Related but also not useful: `ai-tools-mars/claim-flow-ai/` is a mock internal examiner
  dashboard; its only EPC references are two UI labels (Rule 44, Rule 47) in
  `client/src/components/modals/case-details-modal.tsx:42-47`.

## 6. Recommendations for FlowLeap

"Borrow the rule" means reimplementing a public EPC, RFees or WIPO standard rule in our own
code. That is fine. "Borrow the code" means copying EPO source, XSLT, DTD-derived templates,
schemas, locale text or configuration. Do not do that; it is EPO proprietary. Every item below
is "borrow the rule".

| # | Recommendation | Effort | Slice | Kind |
|---|---|---|---|---|
| 1 | Filing manifest written at export: claims total and independent, pages per document and total, drawing sheets, proposed abstract figure, title, language; with Notes for claims over 15 and pages over 35 | S | D2 (`export_draft_docx`) + D1 (counts) | borrow the rule (Rule 45, RFees Art. 2(1) 1a) |
| 2 | Rule 49 page setup in the DOCX: A4, margins, 1.5 spacing, page numbers, line numbers every five lines; then per-type export (description, claims, abstract as three files, or one file with section breaks and a page map in the manifest) | S-M | D2 (`draftDocx.ts`) | borrow the rule (Rule 49, Rule 46) |
| 3 | Four new D1 validators: claim is one sentence (Error, EPO); reference signs in claims in parentheses (Note, Rule 43(7)); no "as shown in Fig." or "as described" in claims (Error, Rule 43(6)); abstract names a figure and carries reference signs in parentheses (Note, Rule 47(4)) | S | D1 | borrow the rule |
| 4 | Make the EPO abstract-length finding a Note, not an Error: Rule 47(3) says "preferably" at most 150 words. Keep Error for US (37 CFR 1.72(b) is "may not exceed") | S | D1 (`specValidators.ts:46-55`) | borrow the rule |
| 5 | Emit a "Reference signs list" and, when cited, a "Citation list" section in EPO export, built from `figures.md` and the background art citations | S | D2 | borrow the rule (WIPO ST.36 section names, public) |
| 6 | Title check: Note when the title has more than about 15 words, a trade mark symbol or a fancy name; take it from the claim 1 preamble when possible | S | D1 + D3 | borrow the rule (Rule 41(2)(b), Guidelines A-III, 7) |
| 7 | Rule 48 items in the advisory review prompt: statements contrary to ordre public, disparaging statements about named competitors, irrelevant matter | S | D3 (skill advisory step) | borrow the rule |
| 8 | Sequence listing gate: when the disclosure names nucleotide or amino-acid sequences, raise an Inventor Question "ST.26 sequence listing required" | S | D3 + D1 | borrow the rule (Rule 30, WIPO ST.26) |
| 9 | Optional PDF export with embedded fonts and no active content, A4, to pass upload checks first time | L | after D5, new slice | borrow the rule (Annex F PDF profile is public in the EPO's OLF documentation) |
| 10 | Do not build a request-data JSON, an Annex F `application-body.xml` or any package files | none | non-goal, add to PRD 0020 non-goals | (not borrowing) |

Notes on ranking:

- Items 1 to 3 give the attorney the values the filing portal asks for and remove the most
  common formal objections, all in pure code without a model call (the D1 guardrail).
- Item 9 is the only "filing-ready" step with real cost. PDF generation with embedded fonts in
  the extension host needs a renderer we do not have. Inference: most attorneys convert in
  Word anyway, so the A4 DOCX of item 2 covers most of the value.

## 7. Sources

EPO tree (`~/epo/`, read only):

- `fo-configuration/config-default.yml` (procedure EP1001 at lines 198-220)
- `fo-configuration/procedures/EP1001/config/attachmentTypes.json`
- `fo-configuration/procedures/EP1001/config/config.yml`
- `fo-configuration/procedures/EP1001/config/receivingOfficesLanguages.json`
- `fo-configuration/procedures/EP1001/annexf/package-manifest.yml`
- `fo-configuration/procedures/EP1001/annexf/xslt/request-xml.xslt`
- `fo-configuration/procedures/EP1001/form/uiSchema.json`
- `fo-configuration/procedures/EP1001/form/schema.jsonschema`
- `fo-configuration/procedures/EP1001/rules/businessRules.dmn`
- `fo-configuration/procedures/common/form/basic-filing.jsonschema`
- `fo-configuration/procedures/common/form/parties.jsonschema`
- `fo-configuration/procedures/common/config/fees.json`
- `fo-configuration/procedures/common/rules/README.md`
- `fo-configuration/procedures/common/annexf/xslt/application-body-xml-v1-7.xslt`
- `fo-configuration/procedures/common/annexf/dtd/WIPO-1.16/application-body-v1-7.dtd`
- `fo-configuration/procedures/common/dtd/ST26SequenceListing_V1_3.dtd`
- `fo-configuration/procedures/PCTRO101/config/attachmentTypes.json`
- `fo-configuration/procedures/NATPAT/config/attachmentTypes.json`
- `fo-configuration/locales/en/resource.json` (lines 933, 1011, 1040, 1108-1111, 1580, 2030, 2074)
- `fo-configuration/services/common/application.yml` (lines 48, 72)
- `file-service/src/main/java/org/epo/itc/frontoffice/file/storage/validation/FileValidationService.java`
- `file-service/src/main/java/org/epo/itc/frontoffice/file/storage/validation/pdf/PdfAnnexfContentValidator.java`
- `file-service/src/main/java/org/epo/itc/frontoffice/file/storage/validation/pdf/PdfAContentValidator.java`
- `file-service/src/main/java/org/epo/itc/frontoffice/file/storage/validation/pdf/PDFUtils.java`
- `file-service/src/main/java/org/epo/itc/frontoffice/file/storage/validation/xml/XMLContentValidator.java`
- `submission-service/src/main/java/org/epo/itc/frontoffice/submission/attachment/AttachmentServiceImpl.java`
- `submission-service/src/main/java/org/epo/itc/frontoffice/submission/attachment/validation/AttachmentValidator.java`
- `submission-service/src/main/java/org/epo/itc/frontoffice/submission/attachment/combinedfile/AttachmentMetaInput.java`
- `frontend/src/components/draft/attachments/hooks/useAttachmentsValidations.js`
- `frontend/src/components/draft/attachments/services/constants.js`
- `frontend/src/components/draft/attachments/uploader/meta/useAttachmentMetaFields.js`
- `front-office-docs/docs/modules/fo-user-guide/pages/submissions/drafting.adoc`
- `upc-drafter/src/App.tsx`, `upc-drafter/src/ckeditor.ts`, `upc-drafter/src/RichTextEditor.tsx`, `upc-drafter/package.json`, `upc-drafter/README.md`
- `upc-knowledge/01-infringement-action.md`
- `fo-configuration-upc/procedures/` (directory listing), `fo-configuration-pmac/procedures/` (directory listing)
- `ai-tools-mars/claim-flow-ai/client/src/components/modals/case-details-modal.tsx`

FlowLeap repository:

- `docs/prd/0020-application-drafting.md`
- `docs/adr/0012-traced-application-drafting.md`
- `extensions/copilot/assets/skills/application-drafting/SKILL.md`
- `extensions/copilot/assets/skills/application-drafting/references/epo-section-order.md`
- `extensions/copilot/src/extension/tools/common/drafting/claimValidators.ts`
- `extensions/copilot/src/extension/tools/common/drafting/specValidators.ts`
- `extensions/copilot/src/extension/tools/vscode-node/draftDocx.ts`

Public law named in this note (not verified against the EPO code): EPC Art. 14, 75, 84, 94,
123(2); Rules 6, 19, 20, 30, 40, 41, 42, 43, 45, 46, 47, 48, 49 EPC; Rules relating to Fees
Art. 2(1) item 1a; Guidelines for Examination A-III and F-IV; WIPO ST.26 and ST.36;
37 CFR 1.72(b).
