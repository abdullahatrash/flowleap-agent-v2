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
});
