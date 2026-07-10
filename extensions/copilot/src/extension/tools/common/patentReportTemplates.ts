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
 *
 * The `invalidity-claim-chart` and `eou-infringement-chart` templates present element-by-element charts,
 * the same shape `compareClaimsTool.ts` renders via {@link renderMarkdownTable}. That renderer cannot be
 * called from here directly — it lives in `tools/vscode-node`, one layer above this `tools/common` module,
 * and this module wraps opaque model-produced text rather than the structured row/column data the renderer
 * needs. Instead, the template's guidance text instructs the model to produce a table using the identical
 * `| Claim Element | ... |` column convention, so charts read the same wherever they appear.
 */
export type PatentReportTemplate =
	| 'prior-art-report'
	| 'fto-memo'
	| 'office-action-scaffold'
	| 'invalidity-claim-chart'
	| 'eou-infringement-chart'
	| 'patentability-opinion'
	| 'landscape-report'
	| 'portfolio-due-diligence-memo';

/** The template identifiers accepted by the tool's input schema. Keep in sync with package.json. */
export const PATENT_REPORT_TEMPLATES: readonly PatentReportTemplate[] = [
	'prior-art-report',
	'fto-memo',
	'office-action-scaffold',
	'invalidity-claim-chart',
	'eou-infringement-chart',
	'patentability-opinion',
	'landscape-report',
	'portfolio-due-diligence-memo',
];

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

		case 'invalidity-claim-chart':
			return [
				'# Invalidity Claim Chart',
				'',
				fieldTable(['Patent No. / Claim(s) at Issue', 'Prior Art Reference(s)', 'Date', 'Prepared By']),
				'',
				'## 1. Overview',
				'_Identify the challenged patent, the claim(s) at issue, and the prior art reference(s) applied against them._',
				'',
				'## 2. Element-by-Element Invalidity Chart',
				'_Render as a markdown table with one row per claim element and one column per prior art reference, mirroring the element-by-element chart produced by compare_claims: `| Claim Element | <Reference 1> | <Reference 2> | ... |`. Each cell quotes or paraphrases the disclosing passage and notes the applicable basis (X/§102 anticipation or Y/§103 obviousness, alone or in combination)._',
				results,
				'',
				'## 3. Basis Summary',
				'_For each ground raised, list the statute (§102 or §103), the claim(s) affected, and the reference(s) or combination relied upon._',
				'',
				'## 4. Claim Language',
				'_Verbatim text of the challenged claim(s), for reference._',
				'',
				'---',
				`*${DISCLAIMER}*`,
				'',
			].join('\n');

		case 'eou-infringement-chart':
			return [
				'# Evidence-of-Use (EoU) Infringement Chart',
				'',
				fieldTable(['Patent No. / Claim(s) Asserted', 'Accused Product / Service', 'Date', 'Prepared By']),
				'',
				'## 1. Overview',
				'_Identify the asserted patent, the claim(s) asserted, and the accused product or service being mapped._',
				'',
				'## 2. Element-by-Element Evidence-of-Use Chart',
				'_Render as a markdown table with one row per claim element and columns for the accused product/feature and supporting evidence, mirroring the element-by-element chart produced by compare_claims: `| Claim Element | Accused Product Feature | Supporting Evidence |`. Cite specifications, teardown reports, marketing materials, or source documentation for each mapped element._',
				results,
				'',
				'## 3. Infringement Theory',
				'_Literal infringement vs. doctrine of equivalents for any elements not literally met, with rationale._',
				'',
				'## 4. Evidentiary Sources',
				'_Documents, specifications, or public materials relied upon for the evidence-of-use mapping._',
				'',
				'---',
				`*${DISCLAIMER}*`,
				'',
			].join('\n');

		case 'patentability-opinion':
			return [
				'# Patentability Opinion',
				'',
				fieldTable(['Matter / Reference', 'Invention Title', 'Date', 'Prepared By']),
				'',
				'## 1. Invention Summary',
				'_Describe the invention, its key features, and the claim(s) or claim concepts under evaluation._',
				'',
				'## 2. Prior Art Discussed',
				'_References considered, with publication/application numbers and a brief description of each._',
				'',
				'## 3. Novelty and Inventive-Step Analysis',
				results,
				'',
				'## 4. Conclusion and Risk Assessment',
				'_Overall patentability conclusion with a risk rating (low/medium/high) and recommended next steps._',
				'',
				'---',
				`*${DISCLAIMER}*`,
				'',
			].join('\n');

		case 'landscape-report':
			return [
				'# Patent Landscape Report',
				'',
				fieldTable(['Technology Area / Scope', 'Search Criteria', 'Date', 'Prepared By']),
				'',
				'## 1. Scope & Methodology',
				'_Technology area covered, search criteria (keywords, CPC/IPC codes, jurisdictions, date range), and data source._',
				'',
				'## 2. Filing Trends, Assignees & Classification Breakdown',
				results,
				'',
				'## 3. White-Space Observations',
				'_Underexplored technology intersections, declining vs. emerging filing activity, and potential opportunity areas suggested by the data._',
				'',
				'---',
				`*${DISCLAIMER}*`,
				'',
			].join('\n');

		case 'portfolio-due-diligence-memo':
			return [
				'# Portfolio Due Diligence Memorandum',
				'',
				fieldTable(['Target / Portfolio', 'Transaction / Purpose', 'Date', 'Prepared By']),
				'',
				'## 1. Portfolio Overview',
				'_Scope of the portfolio reviewed: number of assets, families, jurisdictions, and technology areas._',
				'',
				'## 2. Legal-Status Summary',
				'_Status of each asset (granted, pending, abandoned, expired) and maintenance-fee/annuity standing._',
				'',
				'## 3. Key Asset Analysis',
				results,
				'',
				'## 4. Encumbrances and Risks',
				'_Liens, licenses, litigation history, inventorship or ownership issues, and any other encumbrances identified._',
				'',
				'## 5. Valuation-Relevant Observations',
				'_Factors bearing on portfolio value: claim breadth, remaining term, citation activity, and market relevance._',
				'',
				'---',
				`*${DISCLAIMER}*`,
				'',
			].join('\n');
	}
}
