/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { buildPatentReport } from '../patentReportTemplates';

describe('writePatentResults report templates', () => {

	it('returns content unchanged when no template is requested (free-form save)', () => {
		const content = '# My notes\n\nUS-1234567-B2 looks relevant.';
		expect(buildPatentReport(content, undefined)).toBe(content);
	});

	it('wraps content in the prior-art-report structure', () => {
		expect(buildPatentReport('Found US-1234567-B2 (X, novelty-destroying).', 'prior-art-report')).toMatchInlineSnapshot(`
			"# Prior Art Search Report

			| Field | Details |
			| --- | --- |
			| Matter / Reference | _(to be completed)_ |
			| Subject Technology | _(to be completed)_ |
			| Date | _(to be completed)_ |
			| Prepared By | _(to be completed)_ |

			## 1. Objective
			_Describe the invention and the question the search is intended to answer._

			## 2. Search Strategy
			_Databases searched, classification codes, keyword sets, and date ranges._

			## 3. Documents Considered Relevant
			_ISR-style citation table (Form PCT/ISA/210 section C): \`| Category | Citation of document, with relevant passages | Relevant to claim No. |\`. For the closest X references, follow it with an element-by-element mapping table — \`| Claim element | <Reference 1> | <Reference 2> |\`, one row per claim element, each cell quoting the disclosing passage (original language plus a translation where applicable) — so anticipation is shown per element, not asserted per document._
			Found US-1234567-B2 (X, novelty-destroying).

			**Categories of cited documents:** X — particularly relevant alone (novelty or inventive step); Y — particularly relevant in combination with another such document; A — general state of the art; E — earlier application published on/after the filing date; P — published between the priority date and the filing date; & — member of the same patent family.

			## 4. Relevance Assessment
			_Novelty (§102) and obviousness (§103) observations for the most relevant references._

			---
			*This document was generated with AI assistance for informational purposes only and does not constitute legal advice. Consult a licensed patent attorney before relying on its contents.*
			"
		`);
	});

	it('wraps content in the fto-memo structure', () => {
		expect(buildPatentReport('No in-force blocking claims identified.', 'fto-memo')).toMatchInlineSnapshot(`
			"# Freedom-to-Operate Memorandum

			| Field | Details |
			| --- | --- |
			| Matter / Reference | _(to be completed)_ |
			| Product / Technology | _(to be completed)_ |
			| Jurisdiction(s) | _(to be completed)_ |
			| Date | _(to be completed)_ |
			| Prepared By | _(to be completed)_ |

			## 1. Product / Technology Description
			_Describe the product or process being cleared._

			## 2. Analysis
			No in-force blocking claims identified.

			## 3. Blocking References & Risk
			_In-force claims that may read on the product, with an infringement-risk rating for each._

			## 4. Recommendations
			_Design-around options, licensing, invalidity positions, or further investigation._

			## 5. Assumptions & Limitations
			_Scope of the search and any assumptions made._

			---
			*This document was generated with AI assistance for informational purposes only and does not constitute legal advice. Consult a licensed patent attorney before relying on its contents.*
			"
		`);
	});

	it('wraps content in the office-action-scaffold structure', () => {
		expect(buildPatentReport('Claim 1 is patentable over Smith under §103.', 'office-action-scaffold')).toMatchInlineSnapshot(`
			"# Office Action Response

			| Field | Details |
			| --- | --- |
			| Application No. | _(to be completed)_ |
			| Examiner | _(to be completed)_ |
			| Art Unit | _(to be completed)_ |
			| Mailing Date | _(to be completed)_ |
			| Response Due Date | _(to be completed)_ |
			| Prepared By | _(to be completed)_ |

			## 1. Summary of Rejections
			_List each rejection and objection (statute, claims affected, cited references)._

			## 2. Claim Amendments
			_Complete listing of ALL claims — not only those amended — each with its status identifier ((Original), (Currently Amended), (Canceled), (Withdrawn), (New), (Previously Presented)) and amendments in marked-up form, per 37 CFR 1.121._

			## 3. Remarks
			_Address EVERY ground of rejection and objection raised in the office action (37 CFR 1.111(b)); an unanswered ground makes the reply non-responsive._
			Claim 1 is patentable over Smith under §103.

			## 4. Conclusion
			_Request for allowance and any remaining issues._

			---
			*This document was generated with AI assistance for informational purposes only and does not constitute legal advice. Consult a licensed patent attorney before relying on its contents.*
			"
		`);
	});

	it('wraps content in the invalidity-claim-chart structure', () => {
		expect(buildPatentReport('| Claim Element | US-1234567-B2 | US-7654321-A1 |\n| --- | --- | --- |\n| Preamble | Disclosed | Disclosed |', 'invalidity-claim-chart')).toMatchInlineSnapshot(`
			"# Invalidity Claim Chart

			| Field | Details |
			| --- | --- |
			| Patent No. / Claim(s) at Issue | _(to be completed)_ |
			| Prior Art Reference(s) | _(to be completed)_ |
			| Date | _(to be completed)_ |
			| Prepared By | _(to be completed)_ |

			## 1. Overview
			_Identify the challenged patent, the claim(s) at issue, and the prior art reference(s) applied against them._

			## 2. Prior Art Qualification
			_For each reference: its publication or public-availability date and the statutory basis on which it qualifies as prior art against the earliest claimed priority date (Patent L.R. 3-3(a))._

			## 3. Element-by-Element Invalidity Chart
			_Render as a markdown table with one row per claim element and one column per prior art reference, mirroring the element-by-element chart produced by compare_claims: \`| Claim Element | <Reference 1> | <Reference 2> | ... |\`. Each cell quotes or paraphrases the disclosing passage and notes the applicable basis (X/§102 anticipation or Y/§103 obviousness, alone or in combination)._
			| Claim Element | US-1234567-B2 | US-7654321-A1 |
			| --- | --- | --- |
			| Preamble | Disclosed | Disclosed |

			## 4. Basis Summary
			_For each ground raised, list the statute (§102 or §103), the claim(s) affected, and the reference(s) or combination relied upon — and for EVERY §103 combination, the motivation to combine and its source (Patent L.R. 3-3(b))._

			## 5. Claim Language
			_Verbatim text of the challenged claim(s), for reference._

			---
			*This document was generated with AI assistance for informational purposes only and does not constitute legal advice. Consult a licensed patent attorney before relying on its contents.*
			"
		`);
	});

	it('wraps content in the eou-infringement-chart structure', () => {
		expect(buildPatentReport('| Claim Element | Accused Product Feature | Supporting Evidence |\n| --- | --- | --- |\n| Preamble | Model X | Datasheet p.3 |', 'eou-infringement-chart')).toMatchInlineSnapshot(`
			"# Evidence-of-Use (EoU) Infringement Chart

			| Field | Details |
			| --- | --- |
			| Patent No. / Claim(s) Asserted | _(to be completed)_ |
			| Accused Product / Service | _(to be completed)_ |
			| Date | _(to be completed)_ |
			| Prepared By | _(to be completed)_ |

			## 1. Overview
			_Identify the asserted patent, the claim(s) asserted, and the accused product or service being mapped._

			## 2. Element-by-Element Evidence-of-Use Chart
			_Render as a markdown table with one row per claim element and columns for the accused product/feature and supporting evidence, mirroring the element-by-element chart produced by compare_claims: \`| Claim Element | Accused Product Feature | Literal / DOE | Supporting Evidence |\` — mark EACH element literal or doctrine-of-equivalents (Patent L.R. 3-1(e)). Cite specifications, teardown reports, marketing materials, or source documentation for each mapped element._
			| Claim Element | Accused Product Feature | Supporting Evidence |
			| --- | --- | --- |
			| Preamble | Model X | Datasheet p.3 |

			## 3. Infringement Theory
			_For each element marked DOE in the chart: the function-way-result or insubstantial-differences rationale._

			## 4. Evidentiary Sources
			_Documents, specifications, or public materials relied upon for the evidence-of-use mapping._

			---
			*This document was generated with AI assistance for informational purposes only and does not constitute legal advice. Consult a licensed patent attorney before relying on its contents.*
			"
		`);
	});

	it('wraps content in the patentability-opinion structure', () => {
		expect(buildPatentReport('No single reference discloses the claimed feedback loop; combining refs A and B requires impermissible hindsight.', 'patentability-opinion')).toMatchInlineSnapshot(`
			"# Patentability Opinion

			| Field | Details |
			| --- | --- |
			| Matter / Reference | _(to be completed)_ |
			| Invention Title | _(to be completed)_ |
			| Date | _(to be completed)_ |
			| Prepared By | _(to be completed)_ |

			## 1. Invention Summary
			_Describe the invention, its key features, and the claim(s) or claim concepts under evaluation._

			## 2. Prior Art Discussed
			_References considered, with publication/application numbers and a brief description of each._

			## 3. Novelty and Inventive-Step Analysis
			No single reference discloses the claimed feedback loop; combining refs A and B requires impermissible hindsight.

			## 4. Per-Claim Assessment
			_ISA/237 Box V-style grid: \`| Claim | Novelty (Y/N) | Inventive Step (Y/N) | Key Reference(s) |\` — one row per claim or claim concept evaluated._

			## 5. Conclusion and Risk Assessment
			_Overall patentability conclusion with a risk rating (low/medium/high) and recommended next steps._

			---
			*This document was generated with AI assistance for informational purposes only and does not constitute legal advice. Consult a licensed patent attorney before relying on its contents.*
			"
		`);
	});

	it('wraps content in the landscape-report structure', () => {
		expect(buildPatentReport('### Filing Trend (by publication year)\n2024: 812 patents', 'landscape-report')).toMatchInlineSnapshot(`
			"# Patent Landscape Report

			| Field | Details |
			| --- | --- |
			| Technology Area / Scope | _(to be completed)_ |
			| Search Criteria | _(to be completed)_ |
			| Date | _(to be completed)_ |
			| Prepared By | _(to be completed)_ |

			## 1. Executive Summary
			_The key findings in under a page — for many readers this is the only section read (WIPO Pub 946)._

			## 2. Scope & Methodology
			_Technology area covered, search criteria (keywords, CPC/IPC codes, jurisdictions, date range), data source, and the data cutoff date._

			## 3. Filing Trends, Assignees & Classification Breakdown
			### Filing Trend (by publication year)
			2024: 812 patents

			## 4. White-Space Observations
			_Underexplored technology intersections, declining vs. emerging filing activity, and potential opportunity areas suggested by the data._

			## 5. Issues & Limitations
			_What the data cannot show: coverage and language limits, publication lag on the most recent 18 months, family-counting caveats, and any classification ambiguities._

			---
			*This document was generated with AI assistance for informational purposes only and does not constitute legal advice. Consult a licensed patent attorney before relying on its contents.*
			"
		`);
	});

	it('wraps content in the portfolio-due-diligence-memo structure', () => {
		expect(buildPatentReport('| Asset | Claim Breadth | Forward Citations | Status |\n| --- | --- | --- | --- |\n| US-1234567-B2 | Broad | 42 | In-force |', 'portfolio-due-diligence-memo')).toMatchInlineSnapshot(`
			"# Portfolio Due Diligence Memorandum

			| Field | Details |
			| --- | --- |
			| Target / Portfolio | _(to be completed)_ |
			| Transaction / Purpose | _(to be completed)_ |
			| Date | _(to be completed)_ |
			| Prepared By | _(to be completed)_ |

			## 1. Portfolio Overview
			_Scope of the portfolio reviewed: number of assets, families, jurisdictions, and technology areas._

			## 2. Legal-Status Summary
			_Status of each asset (granted, pending, abandoned, expired) and maintenance-fee/annuity standing._

			## 3. Key Asset Analysis
			| Asset | Claim Breadth | Forward Citations | Status |
			| --- | --- | --- | --- |
			| US-1234567-B2 | Broad | 42 | In-force |

			## 4. Encumbrances and Risks
			_Liens, licenses, litigation history, inventorship or ownership issues, and any other encumbrances identified._

			## 5. Valuation-Relevant Observations
			_Factors bearing on portfolio value: claim breadth, remaining term, citation activity, and market relevance._

			---
			*This document was generated with AI assistance for informational purposes only and does not constitute legal advice. Consult a licensed patent attorney before relying on its contents.*
			"
		`);
	});

	it('prior-art-report fills supplied fields and keeps placeholders for the rest', () => {
		const report = buildPatentReport('- EP1 (close art)', 'prior-art-report', {
			subject: 'Sulfide glass-ceramic solid electrolytes',
			date: '2026-08-12',
			preparedBy: 'FlowLeap Patent AI (AI-assisted draft)',
			objective: 'Find prior art for a sulfide glass-ceramic electrolyte before filing.',
			searchStrategy: 'EPO OPS CQL; H01M paired with discriminating ta terms; 3 probed queries (54/37/15 hits).',
			relevanceAssessment: 'EP1 anticipates the base composition; novelty must rest on narrower ranges.',
		});
		expect(report).toMatchInlineSnapshot(`
			"# Prior Art Search Report

			| Field | Details |
			| --- | --- |
			| Matter / Reference | _(to be completed)_ |
			| Subject Technology | Sulfide glass-ceramic solid electrolytes |
			| Date | 2026-08-12 |
			| Prepared By | FlowLeap Patent AI (AI-assisted draft) |

			## 1. Objective
			Find prior art for a sulfide glass-ceramic electrolyte before filing.

			## 2. Search Strategy
			EPO OPS CQL; H01M paired with discriminating ta terms; 3 probed queries (54/37/15 hits).

			## 3. Documents Considered Relevant
			_ISR-style citation table (Form PCT/ISA/210 section C): \`| Category | Citation of document, with relevant passages | Relevant to claim No. |\`. For the closest X references, follow it with an element-by-element mapping table — \`| Claim element | <Reference 1> | <Reference 2> |\`, one row per claim element, each cell quoting the disclosing passage (original language plus a translation where applicable) — so anticipation is shown per element, not asserted per document._
			- EP1 (close art)

			**Categories of cited documents:** X — particularly relevant alone (novelty or inventive step); Y — particularly relevant in combination with another such document; A — general state of the art; E — earlier application published on/after the filing date; P — published between the priority date and the filing date; & — member of the same patent family.

			## 4. Relevance Assessment
			EP1 anticipates the base composition; novelty must rest on narrower ranges.

			---
			*This document was generated with AI assistance for informational purposes only and does not constitute legal advice. Consult a licensed patent attorney before relying on its contents.*
			"
		`);
	});
});
