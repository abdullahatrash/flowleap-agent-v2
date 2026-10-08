# AI-Powered Patent Drafting: Best Practices, Rules, and Risks

**Date:** 2026-10-07

**Question:** What are the best practices for AI-powered patent drafting, where an LLM writes claims and a specification from an invention disclosure and an attorney edits the result? Scope: (a) how the leading products do it, (b) the regulatory and ethics rules, (c) documented quality risks, (d) practitioner workflows and metrics, (e) technical patterns. The last section lists implications for FlowLeap.

**Method:** Primary sources first (uspto.gov, govinfo.gov Federal Register text, epo.org, americanbar.org, state bar PDFs, court opinions, vendor pages, arXiv). Vendor facts that are already in `competitor-profiles/` are cited to those profiles. Text in quotation marks is verbatim. Text that starts with "Inference:" is my reading, not a source statement. "Unverified" means I could not confirm the fact in a primary source.

## Executive summary

1. The leading drafting products converge on one shape: disclosure or claims in, full draft out, attorney edits in Word or a Word-like editor, and a separate review pass for consistency.
2. Style matching is done with firm templates, "stylebooks", uploaded example applications, or retrieval over a client's prior applications. No vendor publishes how well it works.
3. Drawings sync (one reference numeral per part, used the same in text and figures) is a solved, deterministic problem in Rowan and is now a selling point for DeepIP and Solve.
4. The USPTO April 2024 guidance still applies: "Simply relying on the accuracy of an AI tool is not a reasonable inquiry." The signer owns every statement, citation, and technical fact.
5. The USPTO rescinded its February 2024 AI inventorship guidance on 2025-11-28. The test is now conception by a natural person. AI is a tool. Thaler v. Vidal and EPO J 8/20 bar AI inventors.
6. ABA Formal Opinion 512, the epi Guidelines (2024), Florida 24-1, and the 2026 California guidance all require verification of output and informed client consent before confidential data goes into a tool that can disclose it.
7. The specific drafting risks in primary sources are: AI-added embodiments the inventor did not conceive, §112 support gaps, antecedent basis errors, terminology drift, weak dependent claims, and confidentiality and export exposure of the disclosure.
8. Academic benchmarks (PatentEval, Patent-CE, PatentScore, Dis2Pat, Vibe Patenting) show that generic text metrics do not track expert judgment, and that LLM judges are useful but miscalibrated against attorneys.
9. Time-saving claims are vendor-reported and inconsistent. The only independent first-hand number found is one reviewer's "under two hours" versus "8-10 hours" for a rough draft. The epi warns that checking can remove the net saving.
10. Best practice is a staged, human-gated pipeline: structured intake, claims first, spec generated against the claims, deterministic validators, LLM review as advice only, tracked changes, and a record of what the model added.

---

## (a) How the leading products do it

### Summary table

| Product | Surface | Input | Style matching | Drawings | Review / consistency | Source |
|---|---|---|---|---|---|---|
| DeepIP | Microsoft Word add-in first, web app second | Disclosure, audio inventor interview | "style matching to firm templates"; "customizable drafting styles from uploaded examples" (Bright-Line review) | Sketch to line art, text steps to flowcharts, "synchronized reference labels" | AI Reviewer: antecedent basis, dependency gaps, §101 risk, drawings call-outs | [deepip.md](../../competitor-profiles/deepip.md), https://www.deepip.ai/products/ai-reviewer |
| Solve Intelligence | Browser editor that "works like Microsoft Word" | Disclosure and attorney interaction | Firm "AI styles" and templates set up in "practitioner-led onboarding" | CAD to line drawings, auto-labeling with reference numerals, "Figure Builder" (Feb 2026) | Review tool: terminology, antecedent basis, one-click fixes | [solve-intelligence.md](../../competitor-profiles/solve-intelligence.md), https://www.solveintelligence.com/product/drafting |
| Patlytics | Web app; Word plugin was "Waitlist" in May 2025 | IDF creation, "Ground Truth Verification" of source material | Configurable "stylebook" with "style reference snippets" | Figure-first drafting is an option | Track-changes review of all AI edits | https://www.patlytics.ai/product-updates/may-2-2025 |
| Rowan Patents (Clarivate) | Desktop app, own `.rp` format, Word import/export | Claims, drawings, or brief descriptions | Templates and "Drafting Library" of prior `.rp` work | Built-in drawing tool with synchronized part numbering | Local NLP Review module; "None of your data is sent to the cloud" | [rowan-patents.md](../../competitor-profiles/rowan-patents.md), https://intercom.help/rowanpatents/en/articles/10158004-introducing-the-rowan-patents-review-module |
| IPRally Protection | Web app (launched Sept 2026) | Claims while drafting | Unverified | Unverified | Closest prior art shown "in real time as you write"; edits "proposed, never imposed" | https://www.iprally.com/protection |
| PatentPal | Web app, export to Word and Visio/PowerPoint | Claims | "multiple profiles" of user phrase preferences | Flowcharts for methods, block diagrams for systems | Not stated | https://patentpal.com/ |
| Edge (Ingenia) | Web app | Invention disclosure intake | Unverified | "special objects like figures and sequences" | Not stated | https://www.withedge.com/ |
| Qatent (Questel since 2024) | Web app | Claims | Not stated | Reference lists and figures | Not stated | AIPLA review below; Questel page returned HTTP 402 |
| PatentMaker (DeepIP since 2026-06-09) | Unverified | Unverified | Unverified | Unverified | Unverified | https://www.globallegalpost.com/news/ai-patent-platform-start-up-deepip-acquires-german-ai-assistant-patentmaker-972717147 |
| ClaimMaster | Word add-in, local install | Claims, user prompts | RAG "document workspace" of a client's prior applications | Part-number checks | Rule-based proofreading plus GPT features | https://www.patentclaimmaster.com/ |
| Harvey | General legal AI | Unverified | Unverified | Unverified | Unverified | No patent drafting product page found |

### Notes per vendor

**DeepIP.** The profile records a Word add-in as the primary surface and a full-application drafting module "from disclosure", with "claims drafting with alternative phrasings", "style matching to firm templates", "USPTO/EPO/PCT compliance checks", and "audio inventor-interview input" ([deepip.md](../../competitor-profiles/deepip.md)). The AI Reviewer page says it will "check for antecedent basis errors and dependency gaps", "flag language that mirrors judicial exceptions", give "a real-time probability of rejection", and "catch missing call-outs between drawings and specification" (https://www.deepip.ai/products/ai-reviewer). Results appear "directly inside Microsoft Word" where users can "comment, edit, and track changes" (same page). The page does not say whether the checks are rule-based or model-based. Security: "We do not retain any client data nor use it for model training"; "Microsoft's abuse monitoring is disabled" (https://www.deepip.ai/security). DeepIP acquired PatentMaker, a tool built by a German and European patent attorney and "used by almost 50% of Germany's top IP firms" per the Global Legal Post report (link in table). Inference: DeepIP now has a German-practice drafting base, but I found no primary page that describes PatentMaker's drafting method.

**Solve Intelligence.** The drafting page says "Every attorney drafts differently" and "Interactively draft applications with AI. Customize to your unique drafting style" (https://www.solveintelligence.com/product/drafting). The Review tool goes from "consistent terminology to antecedent basis" with fixes "with a single click" (same page). Firm styles are set up with "practitioner-led onboarding with firm-specific configuration" ([solve-intelligence.md](../../competitor-profiles/solve-intelligence.md)). Security: "Prompts and outputs are never used for model training, are not stored for abuse monitoring and are therefore never subject to human review"; US or EU subprocessors "based on customer selection" (https://www.solveintelligence.com/security). G2 snippets mention "slow performance when generating drawings" and mechanical patents needing "more input and manual intervention" ([solve-intelligence.md](../../competitor-profiles/solve-intelligence.md)).

**Patlytics.** The May 2025 update is the clearest public description of a human-gated drafting flow (https://www.patlytics.ai/product-updates/may-2-2025):
- "Before drafting begins, you can audit source materials and verify key features and embodiments, ensuring the final draft accurately reflects the intended invention."
- "You can create and save multiple stylebook versions and include style reference snippets for consistent drafting."
- "Before committing any AI-suggested modifications, you can now review all proposed changes in a familiar track-changes format."
- Users can "start with pre-written claims, focus on specific figures first, or begin with specification writing".
The Word plugin was on a waitlist then. The profile found no shipped-add-in announcement since ([patlytics.md](../../competitor-profiles/patlytics.md)).

**Rowan Patents.** Rowan is a drafting environment with AI as a helper. Clarivate says: "GenAI is a powerful tool, but its use should always be under the attorney's control" ([rowan-patents.md](../../competitor-profiles/rowan-patents.md)). The AIPLA review says Rowan manages "defined data objects, such as claim terms, definitions, part numbers, and figure references" and shows red warnings for claim terms absent from the spec or drawings (https://www.aipla.org/list/innovate-articles/ai-aids-for-patent-prosecution---product-review). The Review module checks "Antecedent basis", "Unsupported claim concepts", "Part reference consistency", "Acronym definition", and "Profanity/limiting language", using "natural language processing (NLP) and other locally-hosted techniques" (Rowan help article in table). Users can filter issues, ignore them, and insert them as comments. Hardware notes recommend 32 GB RAM "for local LLMs" ([rowan-patents.md](../../competitor-profiles/rowan-patents.md)).

**IPRally Protection.** Two statements matter for workflow design (https://www.iprally.com/protection): "The closest art is visible while you shape a claim, surfaced in real time as you write." and "No change lands in your draft without you accepting it. Every AI edit is proposed, never imposed." A planning mode shows intended changes before they apply.

**PatentPal.** Claims-first generation: "Drop a document into the browser to input your claims", then "Generate spec and figures with one click", then export to Word and Visio (https://patentpal.com/). Inference: this is the "claims drive the spec" pattern in its simplest form.

**Edge (Ingenia).** Ingenia lets users "draft claims and specifications" and handle "special objects like figures and sequences"; the site states "No training on your data, period" and SOC 2 Type II (https://www.withedge.com/). I found no public detail on its review checks.

**Qatent.** The AIPLA reviewer found that Qatent produced "garbled" figures and generic text such as "Figure 4 shows Block Chart 2", and concluded it was "worth following, but it not ready for any serious implementation" (AIPLA review URL above). The review date is not on the page (the profile estimates 2023 to 2024). Questel acquired Qatent in March 2024 (unverified, search-result summary only).

**ClaimMaster.** ClaimMaster is a local Word add-in with "rule-based proofreading" plus GPT features (https://www.patentclaimmaster.com/). It supports OpenAI, Azure OpenAI, and local LLMs through Ollama or LM Studio, so "your data remains completely private and is not sent to the cloud" when local (https://www.patentclaimmaster.com/blog/using-private-gpt-models/). Its RAG workspace guide says: "you can get much better results by setting up a document workspace that includes sections of your client's previous applications" (https://www.patentclaimmaster.com/blog/configuring-document-workspaces-gpt-llms-patent-drafting/, November 2024). Inference: ClaimMaster is the closest public analogue to a BYOK, local-first drafting assistant.

**Harvey.** I found no Harvey product page for patent application drafting. Secondary reports describe patent workflow templates for claim charts, office-action analysis, and invalidity contentions (unverified).

### Cross-vendor patterns (Inference)

- Word is the delivery format in every case. DeepIP and ClaimMaster run inside Word. Solve imitates Word. Rowan and PatentPal export to `.docx`.
- Style matching is configuration plus examples, not fine-tuning, in every public description. No vendor publishes a style-fidelity metric.
- Review is a separate pass after generation. Only Rowan and ClaimMaster say their checks are rule-based or local. DeepIP and Solve do not say.
- Human control is expressed as tracked changes or accept/reject proposals (Patlytics, IPRally, DeepIP in Word).
- Security claims rest on zero-retention model contracts and SOC 2 / ISO 27001. Rowan and ClaimMaster also offer local processing.

---

## (b) Regulatory and ethics guidance

### USPTO: use of AI tools by practitioners (April 2024, still listed as current)

Source: "Guidance on Use of Artificial Intelligence-Based Tools in Practice Before the United States Patent and Trademark Office", 89 FR 25609, 2024-04-11 (https://www.govinfo.gov/content/pkg/FR-2024-04-11/html/2024-07629.htm). The USPTO AI resources page still lists it as current guidance (https://www.uspto.gov/initiatives/artificial-intelligence/artificial-intelligence-resources).

- **No prohibition.** The guidance notes tools that "draft technical specifications, generate responses to Office actions ... and even draft patent claims" and says "there is no prohibition against using these computer tools".
- **Signature and reasonable inquiry (37 CFR 11.18).** "Simply relying on the accuracy of an AI tool is not a reasonable inquiry." The signer must "ensure that all statements in the paper are true" and confirm "the accuracy of all citations to case law and other references".
- **Claims.** "in situations where an AI tool is used to draft patent claims, the practitioner is under a duty to modify those claims as needed to present them in patentable form before submitting them".
- **Specification, drawings, §112.** "practitioners need to take extra care to verify the technical accuracy of the documents and compliance with 35 U.S.C. 112."
- **Prophetic examples.** "appropriate care should be taken to assist the readers in differentiating these examples from actual working examples." This must happen "before initial filing" because later amendment "may constitute new matter".
- **Priority applications.** Foreign or international applications drafted with AI should be "technically accurate to avoid loss of priority".
- **AI-added embodiments.** "when AI makes contributions to drafting portions of the specification and/or claims (e.g., introducing alternate embodiments not contemplated by the inventor(s)), it is appropriate to assess whether the contributions made by natural persons rise to the level of inventorship".
- **Candor (37 CFR 1.56).** If a person knows "one or more of the claims did not have a significant contribution by a human inventor, that information must be disclosed to the USPTO."
- **Confidentiality (37 CFR 11.106).** "AI systems may retain the information that is entered by users", including "using the data to further train its AI models or providing the data to third parties".
- **Export control.** "AI tools may utilize servers located outside the United States, raising the likelihood that any data entered into such tools may be exported". Even on US servers, use "by non-U.S. persons may be deemed an export". Practitioners must "understand an AI tool's terms of use, privacy policies, and cybersecurity practices".
- **Supervision.** Supervisors "must ensure that the practitioners and staff under their supervision comply" when staff rely on AI tools (37 CFR 11.501-503).

Inference: the April 2024 text uses the Pannu "significant contribution" language from the February 2024 inventorship guidance. That inventorship guidance is now rescinded (next section). The candor and verification duties do not depend on it and still apply. How the "significant contribution" sentence reads after November 2025 is unclear. I found no USPTO statement on this point.

### USPTO: inventorship of AI-assisted inventions

- **February 2024 (rescinded).** "Inventorship Guidance for AI-Assisted Inventions", 89 FR 10043, 2024-02-13 (https://www.govinfo.gov/content/pkg/FR-2024-02-13/html/2024-02623.htm). It applied the Pannu factors and said "Merely recognizing a problem or having a general goal or research plan to pursue does not rise to the level of conception."
- **November 2025 (current).** "Revised Inventorship Guidance for AI-Assisted Inventions", 90 FR 54636, FR Doc 2025-21457, 2025-11-28 (https://www.govinfo.gov/content/pkg/FR-2025-11-28/html/2025-21457.htm). Verbatim:
  - "The guidance issued on February 13, 2024 ... is rescinded in its entirety."
  - "Pannu is inapplicable when only one natural person is involved in developing an invention with AI assistance because AI systems are not persons".
  - AI systems "are instruments used by human inventors. They are analogous to laboratory equipment, computer software, research databases, or any other tool".
  - "a priority claim to a foreign application that names an AI tool as the sole inventor will not be accepted."
- A secondary report says the revised guidance states the USPTO "will not question inventorship at the examination stage unless an AI system is expressly listed as an inventor" (https://ipwatchdog.com/2026/05/21/uspto-ai-agenda-examining-the-offices-ai-tools-and-guidance-for-practitioners/). Unverified in the primary text.

### Courts and the EPO on AI inventors

- **Thaler v. Vidal**, 43 F.4th 1207 (Fed. Cir. 2022-08-05): the Patent Act "requires that inventors must be natural persons; that is, human beings." (https://cafc.uscourts.gov/opinions-orders/21-2347.OPINION.8-5-2022_1988142.pdf).
- **EPO J 8/20** (DABUS), 2021-12-21, catchword: "A machine is not an inventor within the meaning of the EPC" (https://www.epo.org/en/boards-of-appeal/decisions/j200008eu1).

### Europe: epi Guidelines on generative AI (adopted November 2024)

Source: epi Professional Conduct Committee, "epi Guidelines: Use of Generative AI in the Work of Patent Attorneys" (https://patentepi.org/assets/uploads/documents/miscellaneous/241120_epi-Guidelines_Use-of-AI.pdf). Adoption at the 16 November 2024 Council meeting is from a search summary (unverified); the text itself says "At present (November 2024)". Verbatim:

- Guideline 1: Members should know each model's "prompt confidentiality" and "the likelihood of hallucinations".
- Guideline 2a: "If there is doubt that confidentiality will be maintained ... the AI model in question should not be used."
- Guideline 2b note: "It is not sufficient for Members to exhibit 'wilful blindness'".
- Guideline 3a: Members "cannot cite the use of generative AI as any excuse for errors or omissions."
- Guideline 3b: work product must be checked so it is "at least of the same standard as if it had been produced by a competent human practitioner." The note adds that "checking requirements ... may not result in net savings of time in specific instances."
- Guideline 4: Members "must in all instances establish, in advance of using generative AI in their cases, the wishes of their clients". The note recommends "accurate records of enquiries sent to clients".
- Guideline 5b: Members "are not required to state, in communications with the European Patent Office and Unified Patent Court, that generative AI has been used" unless a binding rule or client instruction requires it.
- Guideline 6: where the model warrants it, Members must "establish mutually independent user accounts for the work of respective clients."
- Guideline 7a: EU members must apply the EU AI Act (Regulation (EU) 2024/1689) where it applies.

### ABA Formal Opinion 512 (2024-07-29)

Source: https://www.americanbar.org/content/dam/aba/administrative/professional_responsibility/ethics-opinions/aba-formal-opinion-512.pdf (read via the Web Archive copy because the live URL blocked automated fetch).

- Competence: relying on output without "an appropriate degree of independent verification or review of its output ... could violate the duty to provide competent representation". The degree of review "will necessarily depend on the GAI tool and the specific task".
- Confidentiality: for "self-learning GAI tools", "a client's informed consent is required prior to inputting information relating to the representation into such a GAI tool."
- Consent quality: "merely adding general, boiler-plate provisions to engagement letters purporting to authorize the lawyer to use GAI is not sufficient."
- Fees: "a lawyer may not charge a client to learn about how to use a GAI tool or service that the lawyer will regularly use for clients".

### State bars

- **Florida Bar Ethics Opinion 24-1** (2024-01-19), https://www-media.floridabar.org/uploads/2024/01/FL-Bar-Ethics-Op-24-1.pdf: "it is recommended that a lawyer obtain the affected client's informed consent prior to utilizing a third-party generative AI program if the utilization would involve the disclosure of any confidential information." Also: "a lawyer must verify the accuracy and sufficiency of all research performed by generative AI."
- **State Bar of California, Practical Guidance (2026 version)**, https://www.calbar.ca.gov/sites/default/files/portals/0/documents/ethics/Generative-AI-Practical-Guidance.pdf. It "replaces the 2023 version" and adds agentic AI. Verbatim:
  - "the greater the degree of autonomy afforded to an AI system (i.e., agentic systems), the more important it is for a lawyer to implement supervisory controls and verification mechanisms."
  - "a lawyer must not input any confidential information of the client into a generative AI solution that may present material risks to confidentiality or security, absent informed client consent".
  - "Unrestricted or poorly configured agentic systems may unintentionally disclose confidential information (including across different matters)".
  - "A lawyer must not deploy an agentic AI system in a manner that permits autonomous external transmission of client information, including automated communications, filings, or data transfers, without appropriate safeguards and human review."
  - "Hourly billing must reflect the time actually spent on the client's matter".
  - The approval date (reported as 2026-05-14) is unverified.
- **Texas Opinion 705** (February 2025), https://legalethicstexas.com/resources/opinions/opinion-705/: summaries say it requires verification of output, care with confidential data, and no billing for hours "saved". I did not fetch the primary text. Unverified.

### Export control detail

- The April 2024 USPTO guidance (above) is the primary statement on AI and export.
- BIS EAR §734.18 treats some end-to-end encrypted cloud transmissions as not an export. Conditions reported: unclassified data, end-to-end encryption at FIPS 140-2 level or better, and no intentional storage in Country Group D:5 or Russia. Source is secondary (https://www.steptoe.com/en/news-publications/export-control-definitions-finalized-bis-codifies-encryption-safe-harbor-but-ddtc-punts-on-defense-services.html). Unverified against the eCFR text.
- Inference: an LLM provider must decrypt the prompt to process it. So the end-to-end carve-out does not obviously cover model inference. Do not rely on it without export counsel.

---

## (c) Quality risks documented in primary sources

### 1. Embodiments the inventor did not conceive

- USPTO names the risk directly: AI "introducing alternate embodiments not contemplated by the inventor(s)" (April 2024 guidance).
- §112(a) possession: "if a GAI tool generates technical details, embodiments, or examples that the inventor never actually conceived or verified, questions could arise regarding whether the specification demonstrates the inventor's possession" (Baker Donelson, 2026-06-02, https://www.bakerdonelson.com/ai-assisted-patent-drafting-validity-concerns-and-practical-guidance). Practitioner commentary, not law.
- Fix window: wrong content cannot be removed or corrected freely after filing. US: amendment "may constitute new matter" (April 2024 guidance, citing MPEP 608.04(a)). EPO: an amendment fails if the skilled person gets information "not directly and unambiguously derivable" from the application as filed (EPO Guidelines H-IV 2.1, citing G 2/10, https://www.epo.org/en/legal/guidelines-epc/2025/h_iv_2_1.html).
- Observed: the AIPLA reviewer saw "occasional hallucinations about unrelated inventions" in IP Author (AIPLA review, summary of the fetched page).
- Inference: hallucinated embodiments are a double risk. They can raise inventorship and possession questions, and the EPO added-matter rule makes them hard to remove later.

### 2. Prophetic versus working examples

- MPEP 2164.02, quoted in the April 2024 guidance: "prophetic examples should not be described using the past tense, but rather in future or present tense".
- Inference: an LLM that writes a fluent results paragraph in past tense can turn a prophetic example into a false statement of fact.

### 3. Antecedent basis and terminology

- MPEP 2173.05(e): "The lack of clarity could arise where a claim refers to 'said lever' or 'the lever,' where the claim contains no earlier recitation". It also says the failure "does not always render a claim indefinite" (https://www.uspto.gov/web/offices/pac/mpep/s2173.html).
- PatentEval (NAACL 2024) lists "Antecedent Reference Errors" and "Terminological Inconsistency: ... Use of multiple terms or different reference numerals for the same element" in its error typology. Some patent-domain models "have trouble maintaining consistent antecedent referencing" (https://arxiv.org/abs/2406.06589).
- Dis2Pat (2026-08-21): independent claim and specification drafters "occasionally use divergent terms for the same objects" (https://arxiv.org/html/2608.21249).
- Deterministic checkers produce noise. A ClaimMaster user review says most reported antecedent issues are false hits, so manual review of every flag is still needed (Capterra/GetApp snippet, https://www.getapp.ca/reviews/2047356/claimmaster; unverified wording).

### 4. Claim breadth and claim-set structure

PatentEval error types relevant to breadth (https://arxiv.org/abs/2406.06589):
- "Broad Scope Dependent Claims: Dependent claims that insufficiently narrow the scope of the independent claim".
- "Insufficient Differentiation of Independent Claims".
- "Wishful Claiming: Claims that express objectives without concrete methods".
- Finding: LLMs "often demonstrated a tendency to rephrase or repeat previous claims without enhancing specificity in the generated dependent claims".

PatentEval says it does not test novelty or non-obviousness: "We leave the evaluation of novelty and nonobviousness of generated claims for future work." Inference: no public benchmark found measures whether AI claims are well scoped against real prior art. IPRally's "closest art ... surfaced in real time" is the only vendor feature found that targets this.

### 5. §112 support

- USPTO: extra care for "technical accuracy" and "compliance with 35 U.S.C. 112" (April 2024 guidance).
- Rowan checks "Unsupported claim concepts" locally. ClaimMaster checks "specification support". DeepIP checks "unsupported references". (Sources in section (a).)
- Inference: these checks are term-level. A term can appear in the spec without the spec supporting the claimed combination. No vendor page found describes a combination-level support check.

### 6. Inventorship

- Law: only natural persons (Thaler v. Vidal; EPO J 8/20). Standard: conception (USPTO November 2025).
- Drafting angle: the April 2024 guidance links AI-drafted claims to inventorship review and to the candor duty.
- Inference: the drafting tool is the only place where a reliable record of "what came from the disclosure" versus "what the model proposed" can exist. Baker Donelson advises to "Document substantive review" and to "Anticipate discovery of AI-related materials in litigation".

### 7. Confidentiality, disclosure, and export of the invention disclosure

- USPTO: retention, training, third-party sharing, foreign servers, deemed export (April 2024 guidance).
- ABA 512, Florida 24-1, California 2026, epi Guidelines 2a, 2b, 6: consent and due diligence on the tool.
- Novelty-destroying disclosure: "whether inputting information into a GAI platform constitutes a 'public disclosure' at all remains an open question" (Baker Donelson). Unsettled; no case found.
- Cross-matter leakage: California warns of disclosure "across different matters" by agentic systems. epi Guideline 6 requires separate accounts per client where needed.

### 8. Output that looks good to metrics but not to experts

- Patent-CE: "existing studies highlight inconsistencies between automated evaluation metrics and human expert assessments" (https://arxiv.org/abs/2505.11095, ACL 2025).
- PatentScore: conventional NLG metrics "fail to capture the structural and legal characteristics essential to evaluating complex high-stakes documents" (https://arxiv.org/abs/2505.19345).
- PatentWriter: "Patent generation should not be fully automated and requires human supervision" (https://arxiv.org/html/2507.22387v1).

---

## (d) Practitioner workflows and metrics

### First-hand reviews

- **Bright-Line IP, DeepIP review** (2025-05, two-week trial; https://www.brightlineip.com/post/deepip-review-2025, scrape in `competitor-profiles/raw/deepip/2026-09-14/reviews/brightline-ip-review.md`). DeepIP turned "a set of claims and figures ... into a rough draft in under two hours, whereas it would usually take 8-10 hours". Scores: Competence 10/10, Workflow Integration 7/10. Weaknesses: "inconsistent context retention between prompts" and "Lack of feature parity between Word plugin and web app". Note: the input was claims plus figures, not a raw disclosure.
- **AIPLA product review** (Henry H. Perritt Jr.; date not shown). Rowan is "ready for deployment as production elements in patent prosecution workflow". IP Author is "not perfect", with "flowchart errors" and hallucinations. Qatent is "not ready for any serious implementation". General advice: "a skilled patent lawyer will have to pay close attention to claims language".
- **G2 snippets for Solve** mention "a fair learning curve", slow drawing generation, and more manual work on mechanical patents ([solve-intelligence.md](../../competitor-profiles/solve-intelligence.md)).

### Vendor-reported metrics (not independently verified)

| Vendor | Claim | Source |
|---|---|---|
| DeepIP | "up to 70% Drafting time reduction"; "2h+ Saved per attorney, per day" | [deepip.md](../../competitor-profiles/deepip.md) |
| Solve | "50% average workload reduction", "60-80%", "90%+ more productive", "60-90%" on different pages | [solve-intelligence.md](../../competitor-profiles/solve-intelligence.md) |
| Solve customer (Marbury Law) | "3x-4x efficiency gain" | [solve-intelligence.md](../../competitor-profiles/solve-intelligence.md) |
| Rowan customer | "30-40 hours per application ... Cut in half"; fewer clarity errors | [rowan-patents.md](../../competitor-profiles/rowan-patents.md) |
| DeepIP customer (Dilworth IP) | "Write longer and more robust, more detailed applications in the same amount of time." | [deepip.md](../../competitor-profiles/deepip.md) |

Inference: the numbers vary by page and come with no published method. The Dilworth quote is useful because it says the gain went into quality under a fixed fee, not into fewer hours.

### Review burden

- epi: checking "may not result in net savings of time in specific instances" (Guideline 3b note).
- ABA 512: the review level depends on "the GAI tool and the specific task".
- Williams (2026-07-30) says legal AI guidance "repeatedly call[s] for evidence that does not exist (e.g., error rates, do-not-use lists)" (https://arxiv.org/abs/2607.28869).
- Inference: no source found measures attorney review time per AI-drafted application. Claims of time saved count drafting time, not drafting plus verification.

### Common workflow shape across sources (Inference)

1. Intake: disclosure document, inventor interview (DeepIP audio), or existing claims (PatentPal, Bright-Line test).
2. Feature verification before drafting (Patlytics "Ground Truth Verification").
3. Claims first, with alternatives (DeepIP "alternative phrasings"; PatentPal claims-in).
4. Spec, figures, abstract generated against the claims.
5. Review pass for antecedent basis, terminology, numerals, support (all vendors).
6. Attorney edit in Word with tracked changes.
7. Inventor review. Rowan case studies report clients who "make no changes to initial drafts" ([rowan-patents.md](../../competitor-profiles/rowan-patents.md)).

### Academic benchmarks

| Paper | Date | Task | Key finding |
|---|---|---|---|
| PatentEval (Zuo et al., Inria and Qatent) https://arxiv.org/abs/2406.06589 | 2024-06 (NAACL) | Claims to abstract; next-claim generation | Error typology anchored in WIPO drafting guide; expert annotator with 15+ years; ChatGPT had fewest errors among tested models |
| AutoPatent https://arxiv.org/abs/2412.09796 | 2024-12-13 | Full patent (~17K tokens) from draft | Planner, writer, and examiner agents; Qwen2.5-7B in the framework beat GPT-4o and larger models |
| Patent-CE / PatClaimEval https://arxiv.org/abs/2505.11095 | 2025-05-16 (ACL) | Claim evaluation | Five criteria: feature completeness, conceptual clarity, terminology consistency, logical linkage, overall quality |
| PatentScore https://arxiv.org/abs/2505.19345 | 2025-05-25 | Claim evaluation | Structural, semantic, legal dimensions; r = 0.819 with experts |
| PatentWriter https://arxiv.org/html/2507.22387v1 | 2025-07-30 | Abstract generation | BERTScore above 0.85 for all models; says human supervision is required |
| Dis2Pat https://arxiv.org/html/2608.21249 | 2026-08-21 | Full application from inventor-style disclosure plus figures | Multi-agent system near GPT-5 on spec quality; figures help spec but not claims; failure modes: missed features, terminology drift, spatial errors |
| Vibe Patenting https://arxiv.org/abs/2609.13422 | 2026-09-11 | LLM judges for drafting agents | Judge-guided revision beats unguided revision; attorney validation shows "meaningful but strongly metric-dependent agreement and systematic calibration differences" |

Inference: Dis2Pat is the closest benchmark to the real task (informal disclosure in, full application out). Its "manager routing omissions" finding means a missed feature at intake cannot be recovered by later polishing. This supports a feature-verification gate before drafting.

---

## (e) Technical patterns

### 1. Retrieval of prior applications for style

- Patterns in use: per-client RAG workspace (ClaimMaster), stylebook with reference snippets (Patlytics), searchable library of prior work (Rowan Drafting Library), uploaded examples (DeepIP, per Bright-Line), user phrase profiles (PatentPal), onboarding-configured firm styles (Solve).
- ClaimMaster lets the user tell the model to use only workspace content or to add its own knowledge, through a `[RAGDATA]` instruction placeholder (workspace guide above).
- Inference: style retrieval crosses matters by design. It needs the consent and per-client separation that epi Guideline 6 and California describe. Retrieve form (boilerplate, definitions, section order), not technical content from another client's matter.

### 2. Structured disclosure intake

- Patlytics verifies "key features and embodiments" before drafting. Edge advertises disclosure intake. DeepIP takes audio interviews.
- Dis2Pat shows that a feature missed at the routing step stays missed.
- Inference: a structured intake record (features, alternatives the inventor states, known prior art, which examples are real versus prophetic) is the ground truth that every later check compares against.

### 3. Claim-to-spec consistency checking

- Checks found in products: claim term present in spec and drawings (Rowan red warnings), unsupported claim concepts (Rowan), specification support (ClaimMaster), unsupported references (DeepIP), terminology consistency (Solve).
- Academic signal: terminology consistency and logical linkage are core criteria in Patent-CE.
- Inference: term presence is easy to check in code. Combination-level support and possession need human review, possibly helped by an LLM that cites the exact supporting passages.

### 4. Reference-numeral management

- Rules: "The same part of an invention appearing in more than one view of the drawing must always be designated by the same reference character, and the same reference character must never be used to designate different parts." "Reference characters not mentioned in the description shall not appear in the drawings. Reference characters mentioned in the description must appear in the drawings." (37 CFR 1.84(p)(4)-(5), https://www.law.cornell.edu/cfr/text/37/1.84).
- EPO: reference signs in claims "shall preferably" follow features in parentheses and "shall not be construed as limiting the claim" (Rule 43(7) EPC, https://www.epo.org/en/legal/epc/2020/r43.html).
- Products: Rowan synchronized part numbering; Solve auto-labeling; DeepIP "synchronized reference labels".
- Inference: numerals are a data model (part, numeral, name, figures) with the text and figures as views of it. This is deterministic work. An LLM should propose names and parts, and code should assign and check numerals.

### 5. Deterministic validators versus LLM self-review

- Deterministic and local: Rowan Review ("locally-hosted techniques"), ClaimMaster ("rule-based proofreading"). Weakness: false hits that the user must triage.
- LLM-based judging: AutoPatent examiner agent; Vibe Patenting judges. Strength: catches semantic issues. Weakness: "systematic calibration differences" from attorneys.
- Metrics: generic NLG metrics do not track experts (Patent-CE, PatentScore).
- Inference: run deterministic checks for anything that has a formal rule (antecedent basis, dependency targets, claim numbering, numerals, prophetic tense markers, defined terms). Use LLM review for clarity, scope, and support, and show it as advice with cited passages, never as a pass/fail gate.

### 6. Human-in-the-loop checkpoints

- Sources for each gate: feature verification before drafting (Patlytics); every edit proposed, not applied (IPRally); tracked changes (Patlytics, DeepIP); no autonomous external transmission or filing (California 2026); signer verifies every statement and citation (USPTO); records of client consent (epi Guideline 4).
- Inference, minimum gate list:
  1. Client consent for the tool and model provider is on record.
  2. Feature list from the disclosure is confirmed by the attorney.
  3. Independent claims are approved before spec generation.
  4. Every model-added embodiment or example is confirmed by the inventor or deleted.
  5. All validator flags are resolved or waived with a reason.
  6. Final review and signature by the practitioner. The tool never files.

---

## Implications for FlowLeap

Context: FlowLeap is a local-first, BYOK patent IDE. Today it ships search, analysis, and grounded reports. It also ships a claim-drafting skill (`src/vs/sessions/skills/recipe-claim-drafting/SKILL.md` and the bundled `claim-drafting` skill) and an invention-disclosure skill. It does not draft full applications (specification, figures, numerals) today.

### What a drafting feature must get right

1. **Every specification sentence traces to a source.** The source is a disclosure span, an inventor answer, or an attorney instruction. This is the Verified-Data Contract applied to prose. A sentence with no source is marked as model-proposed in the draft and in the working record. This directly addresses the USPTO "alternate embodiments not contemplated" risk and the EPO added-matter rule.
2. **Unsupported stays marked until a human resolves it.** Model-added embodiments, alternatives, and examples need inventor confirmation or deletion before export. Prophetic examples carry a marker and are checked for tense.
3. **Deterministic validators run as code.** Antecedent basis, claim dependency targets, claim numbering, defined-term consistency, reference numerals per 37 CFR 1.84(p), and claim-term presence in the spec. Their output is a list the attorney can filter and waive with a reason, as in Rowan.
4. **LLM review is advisory and cites passages.** It covers scope, clarity, and combination-level support. It never marks a draft "passed". This follows the Vibe Patenting calibration finding.
5. **Claims first, against the closest art.** The existing claim-drafting skill already starts from the closest art. Spec generation should start only after the attorney approves the independent claims.
6. **Intake is a gate.** The attorney confirms the feature list before drafting, because Dis2Pat shows missed features are not recovered later.
7. **The working record is the inventorship and diligence record.** It logs the disclosure version, the model and provider, prompts, what the model proposed, and what the attorney accepted, changed, or deleted. This serves the candor duty, Baker Donelson's "Document substantive review" advice, and epi Guideline 4 records.
8. **Output is `.docx` with tracked changes.** Every vendor delivers Word. Edits to an existing draft are proposals, not overwrites (IPRally, Patlytics).

### Where BYOK and local-first help, and where they shift duties

- Local files and BYOK remove FlowLeap as a data holder for the disclosure. They do not remove the attorney's duty to vet the model provider (epi 2a and 2b, ABA 512, USPTO export note). The feature should show which provider and region the draft goes to before the first call. It should support local models for matters that cannot leave the machine, as ClaimMaster does.
- Style retrieval must stay inside one client's matters unless the user chooses otherwise. Per-client separation follows epi Guideline 6 and the California cross-matter warning.
- The tool must never file or send anything externally on its own (California 2026).

### What to avoid

- Publishing time-saved percentages without a method. The vendor numbers above conflict, and the epi says checking can cancel the saving.
- Using an LLM judge or self-review as the only quality gate.
- Silently expanding the disclosure with "additional embodiments" to make the spec longer.
- Past-tense results text for examples the inventor did not run.
- Cross-client style retrieval by default.
- Describing the feature as making the attorney's review optional. Every primary source in section (b) puts the duty on the signer.

---

## Sources

### Regulation, case law, ethics (primary)

- USPTO, Guidance on Use of AI-Based Tools in Practice Before the USPTO, 89 FR 25609 (2024-04-11): https://www.govinfo.gov/content/pkg/FR-2024-04-11/html/2024-07629.htm
- USPTO, Inventorship Guidance for AI-Assisted Inventions, 89 FR 10043 (2024-02-13), rescinded: https://www.govinfo.gov/content/pkg/FR-2024-02-13/html/2024-02623.htm
- USPTO, Revised Inventorship Guidance for AI-Assisted Inventions, 90 FR 54636 (2025-11-28): https://www.govinfo.gov/content/pkg/FR-2025-11-28/html/2025-21457.htm
- USPTO announcement of revised guidance: https://www.uspto.gov/subscription-center/2025/revised-inventorship-guidance-ai-assisted-inventions
- USPTO AI resources page: https://www.uspto.gov/initiatives/artificial-intelligence/artificial-intelligence-resources
- Thaler v. Vidal, 43 F.4th 1207 (Fed. Cir. 2022): https://cafc.uscourts.gov/opinions-orders/21-2347.OPINION.8-5-2022_1988142.pdf
- EPO J 8/20 (DABUS): https://www.epo.org/en/boards-of-appeal/decisions/j200008eu1
- EPO Guidelines H-IV 2.1 (added matter): https://www.epo.org/en/legal/guidelines-epc/2025/h_iv_2_1.html
- EPC Rule 43: https://www.epo.org/en/legal/epc/2020/r43.html
- MPEP 2173 (incl. 2173.05(e)): https://www.uspto.gov/web/offices/pac/mpep/s2173.html
- 37 CFR 1.84: https://www.law.cornell.edu/cfr/text/37/1.84
- epi Guidelines, Use of Generative AI (2024): https://patentepi.org/assets/uploads/documents/miscellaneous/241120_epi-Guidelines_Use-of-AI.pdf
- ABA Formal Opinion 512 (2024-07-29): https://www.americanbar.org/content/dam/aba/administrative/professional_responsibility/ethics-opinions/aba-formal-opinion-512.pdf
- Florida Bar Ethics Opinion 24-1 (2024-01-19): https://www-media.floridabar.org/uploads/2024/01/FL-Bar-Ethics-Op-24-1.pdf
- State Bar of California, Practical Guidance (2026): https://www.calbar.ca.gov/sites/default/files/portals/0/documents/ethics/Generative-AI-Practical-Guidance.pdf
- Texas Opinion 705 (not fetched): https://legalethicstexas.com/resources/opinions/opinion-705/

### Academic

- PatentEval: https://arxiv.org/abs/2406.06589
- AutoPatent: https://arxiv.org/abs/2412.09796
- Towards Better Evaluation for Generated Patent Claims (Patent-CE): https://arxiv.org/abs/2505.11095
- PatentScore: https://arxiv.org/abs/2505.19345
- PatentWriter: https://arxiv.org/html/2507.22387v1
- Benchmarking Patent Drafting from Inventor-Style Disclosures (Dis2Pat): https://arxiv.org/html/2608.21249
- Vibe Patenting: https://arxiv.org/abs/2609.13422
- From Process to Evidence (Williams): https://arxiv.org/abs/2607.28869
- Patentformer demo: https://arxiv.org/abs/2510.09752

### Vendors (primary pages)

- DeepIP AI Reviewer: https://www.deepip.ai/products/ai-reviewer
- DeepIP security: https://www.deepip.ai/security
- Solve drafting: https://www.solveintelligence.com/product/drafting
- Solve security: https://www.solveintelligence.com/security
- Patlytics May 2025 update: https://www.patlytics.ai/product-updates/may-2-2025
- Rowan Review module: https://intercom.help/rowanpatents/en/articles/10158004-introducing-the-rowan-patents-review-module
- IPRally Protection: https://www.iprally.com/protection
- PatentPal: https://patentpal.com/
- Edge: https://www.withedge.com/
- ClaimMaster: https://www.patentclaimmaster.com/
- ClaimMaster private and local LLMs: https://www.patentclaimmaster.com/blog/using-private-gpt-models/
- ClaimMaster RAG workspaces: https://www.patentclaimmaster.com/blog/configuring-document-workspaces-gpt-llms-patent-drafting/
- ClaimMaster 2026 LLM features: https://www.patentclaimmaster.com/blog/llm-patent-drafting-improvements-claimmaster-2026/

### Practitioner reviews and commentary

- Bright-Line IP, DeepIP Review 2025: https://www.brightlineip.com/post/deepip-review-2025
- AIPLA, AI Aids for Patent Prosecution: Product Review: https://www.aipla.org/list/innovate-articles/ai-aids-for-patent-prosecution---product-review
- Baker Donelson, AI-Assisted Patent Drafting: Validity Concerns (2026-06-02): https://www.bakerdonelson.com/ai-assisted-patent-drafting-validity-concerns-and-practical-guidance

### Secondary (used only to locate or where primary was not reachable)

- Global Legal Post on DeepIP and PatentMaker: https://www.globallegalpost.com/news/ai-patent-platform-start-up-deepip-acquires-german-ai-assistant-patentmaker-972717147
- IPWatchdog on USPTO AI agenda (2026-05-21): https://ipwatchdog.com/2026/05/21/uspto-ai-agenda-examining-the-offices-ai-tools-and-guidance-for-practitioners/
- Steptoe on EAR encryption carve-out: https://www.steptoe.com/en/news-publications/export-control-definitions-finalized-bis-codifies-encryption-safe-harbor-but-ddtc-punts-on-defense-services.html
- ClaimMaster user reviews (GetApp): https://www.getapp.ca/reviews/2047356/claimmaster

### Internal

- `competitor-profiles/deepip.md`, `solve-intelligence.md`, `patlytics.md`, `rowan-patents.md`, `iprally.md`, and raw review scrapes under `competitor-profiles/raw/`.
