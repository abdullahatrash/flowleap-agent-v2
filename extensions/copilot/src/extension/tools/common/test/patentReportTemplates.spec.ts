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

			## 3. Findings
			Found US-1234567-B2 (X, novelty-destroying).

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
			_List each rejection (statute, claims affected, cited references)._

			## 2. Response & Arguments
			Claim 1 is patentable over Smith under §103.

			## 3. Claim Amendments
			_Proposed amendments in marked-up form, if any._

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

			## 2. Element-by-Element Invalidity Chart
			_Render as a markdown table with one row per claim element and one column per prior art reference, mirroring the element-by-element chart produced by compare_claims: \`| Claim Element | <Reference 1> | <Reference 2> | ... |\`. Each cell quotes or paraphrases the disclosing passage and notes the applicable basis (X/§102 anticipation or Y/§103 obviousness, alone or in combination)._
			| Claim Element | US-1234567-B2 | US-7654321-A1 |
			| --- | --- | --- |
			| Preamble | Disclosed | Disclosed |

			## 3. Basis Summary
			_For each ground raised, list the statute (§102 or §103), the claim(s) affected, and the reference(s) or combination relied upon._

			## 4. Claim Language
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
			_Render as a markdown table with one row per claim element and columns for the accused product/feature and supporting evidence, mirroring the element-by-element chart produced by compare_claims: \`| Claim Element | Accused Product Feature | Supporting Evidence |\`. Cite specifications, teardown reports, marketing materials, or source documentation for each mapped element._
			| Claim Element | Accused Product Feature | Supporting Evidence |
			| --- | --- | --- |
			| Preamble | Model X | Datasheet p.3 |

			## 3. Infringement Theory
			_Literal infringement vs. doctrine of equivalents for any elements not literally met, with rationale._

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

			## 4. Conclusion and Risk Assessment
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

			## 1. Scope & Methodology
			_Technology area covered, search criteria (keywords, CPC/IPC codes, jurisdictions, date range), and data source._

			## 2. Filing Trends, Assignees & Classification Breakdown
			### Filing Trend (by publication year)
			2024: 812 patents

			## 3. White-Space Observations
			_Underexplored technology intersections, declining vs. emerging filing activity, and potential opportunity areas suggested by the data._

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
});
