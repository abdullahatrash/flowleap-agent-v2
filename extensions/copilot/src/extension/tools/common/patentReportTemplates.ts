/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Named report templates for {@link ToolName.WritePatentResults}. Each template wraps the model's
 * free-form content in a consistent, professional document structure (title block, matter/date
 * placeholder fields, standard sections for the document type, a results area where the model's
 * content lands, and a not-legal-advice disclaimer footer).
 *
 * Kept free of any `vscode` dependency so the pure document shaping is unit-testable in isolation.
 */
export type PatentReportTemplate = 'prior-art-report' | 'fto-memo' | 'office-action-scaffold';

/** The template identifiers accepted by the tool's input schema. Keep in sync with package.json. */
export const PATENT_REPORT_TEMPLATES: readonly PatentReportTemplate[] = ['prior-art-report', 'fto-memo', 'office-action-scaffold'];

/** Footer appended to every templated report. */
const DISCLAIMER = 'This document was generated with AI assistance for informational purposes only and does not constitute legal advice. Consult a licensed patent attorney before relying on its contents.';

/** Placeholder for a field the practitioner fills in after generation. */
const FIELD = '_(to be completed)_';

/** Render a `| Field | Value |` metadata table from ordered rows. */
function fieldTable(rows: readonly string[]): string {
	return ['| Field | Details |', '| --- | --- |', ...rows.map(label => `| ${label} | ${FIELD} |`)].join('\n');
}

/**
 * Wrap the model-produced `content` in the professional structure named by `template`. When
 * `template` is undefined the content is returned unchanged (free-form save).
 */
export function buildPatentReport(content: string, template: PatentReportTemplate | undefined): string {
	if (!template) {
		return content;
	}

	const results = content.trim().length > 0 ? content.trim() : FIELD;

	switch (template) {
		case 'prior-art-report':
			return [
				'# Prior Art Search Report',
				'',
				fieldTable(['Matter / Reference', 'Subject Technology', 'Date', 'Prepared By']),
				'',
				'## 1. Objective',
				'_Describe the invention and the question the search is intended to answer._',
				'',
				'## 2. Search Strategy',
				'_Databases searched, classification codes, keyword sets, and date ranges._',
				'',
				'## 3. Findings',
				results,
				'',
				'## 4. Relevance Assessment',
				'_Novelty (§102) and obviousness (§103) observations for the most relevant references._',
				'',
				'---',
				`*${DISCLAIMER}*`,
				'',
			].join('\n');

		case 'fto-memo':
			return [
				'# Freedom-to-Operate Memorandum',
				'',
				fieldTable(['Matter / Reference', 'Product / Technology', 'Jurisdiction(s)', 'Date', 'Prepared By']),
				'',
				'## 1. Product / Technology Description',
				'_Describe the product or process being cleared._',
				'',
				'## 2. Analysis',
				results,
				'',
				'## 3. Blocking References & Risk',
				'_In-force claims that may read on the product, with an infringement-risk rating for each._',
				'',
				'## 4. Recommendations',
				'_Design-around options, licensing, invalidity positions, or further investigation._',
				'',
				'## 5. Assumptions & Limitations',
				'_Scope of the search and any assumptions made._',
				'',
				'---',
				`*${DISCLAIMER}*`,
				'',
			].join('\n');

		case 'office-action-scaffold':
			return [
				'# Office Action Response',
				'',
				fieldTable(['Application No.', 'Examiner', 'Art Unit', 'Mailing Date', 'Response Due Date', 'Prepared By']),
				'',
				'## 1. Summary of Rejections',
				'_List each rejection (statute, claims affected, cited references)._',
				'',
				'## 2. Response & Arguments',
				results,
				'',
				'## 3. Claim Amendments',
				'_Proposed amendments in marked-up form, if any._',
				'',
				'## 4. Conclusion',
				'_Request for allowance and any remaining issues._',
				'',
				'---',
				`*${DISCLAIMER}*`,
				'',
			].join('\n');
	}
}
