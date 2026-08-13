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

/**
 * Values known at generation time. The tool supplies `date`/`preparedBy`; the model supplies the
 * rest from the conversation. Anything absent falls back to the practitioner placeholder, so a
 * report is never blocked on missing metadata — but is no longer an empty form when the
 * information was right there in the request.
 */
export interface PatentReportFields {
	readonly matter?: string;
	readonly subject?: string;
	readonly date?: string;
	readonly preparedBy?: string;
	readonly objective?: string;
	readonly searchStrategy?: string;
	readonly relevanceAssessment?: string;
}

/** Render a `| Field | Value |` metadata table; empty values fall back to the placeholder. */
function fieldTable(rows: readonly [string, string | undefined][]): string {
	return ['| Field | Details |', '| --- | --- |', ...rows.map(([label, value]) => `| ${label} | ${value?.trim() || FIELD} |`)].join('\n');
}

/** A scaffold section body: the supplied text, or the italic guidance stub when absent. */
function section(stub: string, value: string | undefined): string {
	return value?.trim() ? value.trim() : stub;
}

/**
 * Wrap the model-produced `content` in the professional structure named by `template`. When
 * `template` is undefined the content is returned unchanged (free-form save).
 */
export function buildPatentReport(content: string, template: PatentReportTemplate | undefined, fields?: PatentReportFields): string {
	if (!template) {
		return content;
	}

	const f = fields ?? {};
	const results = content.trim().length > 0 ? content.trim() : FIELD;

	switch (template) {
		case 'prior-art-report':
			return [
				'# Prior Art Search Report',
				'',
				fieldTable([['Matter / Reference', f.matter], ['Subject Technology', f.subject], ['Date', f.date], ['Prepared By', f.preparedBy]]),
				'',
				'## 1. Objective',
				section('_Describe the invention and the question the search is intended to answer._', f.objective),
				'',
				'## 2. Search Strategy',
				section('_Databases searched, classification codes, keyword sets, and date ranges._', f.searchStrategy),
				'',
				'## 3. Documents Considered Relevant',
				'_ISR-style citation table (Form PCT/ISA/210 section C): `| Category | Citation of document, with relevant passages | Relevant to claim No. |`. For the closest X references, follow it with an element-by-element mapping table — `| Claim element | <Reference 1> | <Reference 2> |`, one row per claim element, each cell quoting the disclosing passage (original language plus a translation where applicable) — so anticipation is shown per element, not asserted per document._',
				results,
				'',
				'**Categories of cited documents:** X — particularly relevant alone (novelty or inventive step); Y — particularly relevant in combination with another such document; A — general state of the art; E — earlier application published on/after the filing date; P — published between the priority date and the filing date; & — member of the same patent family.',
				'',
				'## 4. Relevance Assessment',
				section('_Novelty (§102) and obviousness (§103) observations for the most relevant references._', f.relevanceAssessment),
				'',
				'---',
				`*${DISCLAIMER}*`,
				'',
			].join('\n');

		case 'fto-memo':
			return [
				'# Freedom-to-Operate Memorandum',
				'',
				fieldTable([['Matter / Reference', f.matter], ['Product / Technology', f.subject], ['Jurisdiction(s)', undefined], ['Date', f.date], ['Prepared By', f.preparedBy]]),
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
				fieldTable([['Application No.', f.matter], ['Examiner', undefined], ['Art Unit', undefined], ['Mailing Date', undefined], ['Response Due Date', undefined], ['Prepared By', f.preparedBy]]),
				'',
				'## 1. Summary of Rejections',
				'_List each rejection and objection (statute, claims affected, cited references)._',
				'',
				'## 2. Claim Amendments',
				'_Complete listing of ALL claims — not only those amended — each with its status identifier ((Original), (Currently Amended), (Canceled), (Withdrawn), (New), (Previously Presented)) and amendments in marked-up form, per 37 CFR 1.121._',
				'',
				'## 3. Remarks',
				'_Address EVERY ground of rejection and objection raised in the office action (37 CFR 1.111(b)); an unanswered ground makes the reply non-responsive._',
				results,
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
				fieldTable([['Patent No. / Claim(s) at Issue', f.matter], ['Prior Art Reference(s)', f.subject], ['Date', f.date], ['Prepared By', f.preparedBy]]),
				'',
				'## 1. Overview',
				'_Identify the challenged patent, the claim(s) at issue, and the prior art reference(s) applied against them._',
				'',
				'## 2. Prior Art Qualification',
				'_For each reference: its publication or public-availability date and the statutory basis on which it qualifies as prior art against the earliest claimed priority date (Patent L.R. 3-3(a))._',
				'',
				'## 3. Element-by-Element Invalidity Chart',
				'_Render as a markdown table with one row per claim element and one column per prior art reference, mirroring the element-by-element chart produced by compare_claims: `| Claim Element | <Reference 1> | <Reference 2> | ... |`. Each cell quotes or paraphrases the disclosing passage and notes the applicable basis (X/§102 anticipation or Y/§103 obviousness, alone or in combination)._',
				results,
				'',
				'## 4. Basis Summary',
				'_For each ground raised, list the statute (§102 or §103), the claim(s) affected, and the reference(s) or combination relied upon — and for EVERY §103 combination, the motivation to combine and its source (Patent L.R. 3-3(b))._',
				'',
				'## 5. Claim Language',
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
				fieldTable([['Patent No. / Claim(s) Asserted', f.matter], ['Accused Product / Service', f.subject], ['Date', f.date], ['Prepared By', f.preparedBy]]),
				'',
				'## 1. Overview',
				'_Identify the asserted patent, the claim(s) asserted, and the accused product or service being mapped._',
				'',
				'## 2. Element-by-Element Evidence-of-Use Chart',
				'_Render as a markdown table with one row per claim element and columns for the accused product/feature and supporting evidence, mirroring the element-by-element chart produced by compare_claims: `| Claim Element | Accused Product Feature | Literal / DOE | Supporting Evidence |` — mark EACH element literal or doctrine-of-equivalents (Patent L.R. 3-1(e)). Cite specifications, teardown reports, marketing materials, or source documentation for each mapped element._',
				results,
				'',
				'## 3. Infringement Theory',
				'_For each element marked DOE in the chart: the function-way-result or insubstantial-differences rationale._',
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
				fieldTable([['Matter / Reference', f.matter], ['Invention Title', f.subject], ['Date', f.date], ['Prepared By', f.preparedBy]]),
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
				'## 4. Per-Claim Assessment',
				'_ISA/237 Box V-style grid: `| Claim | Novelty (Y/N) | Inventive Step (Y/N) | Key Reference(s) |` — one row per claim or claim concept evaluated._',
				'',
				'## 5. Conclusion and Risk Assessment',
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
				fieldTable([['Technology Area / Scope', f.subject], ['Search Criteria', f.searchStrategy], ['Date', f.date], ['Prepared By', f.preparedBy]]),
				'',
				'## 1. Executive Summary',
				'_The key findings in under a page — for many readers this is the only section read (WIPO Pub 946)._',
				'',
				'## 2. Scope & Methodology',
				section('_Technology area covered, search criteria (keywords, CPC/IPC codes, jurisdictions, date range), data source, and the data cutoff date._', f.searchStrategy),
				'',
				'## 3. Filing Trends, Assignees & Classification Breakdown',
				results,
				'',
				'## 4. White-Space Observations',
				'_Underexplored technology intersections, declining vs. emerging filing activity, and potential opportunity areas suggested by the data._',
				'',
				'## 5. Issues & Limitations',
				'_What the data cannot show: coverage and language limits, publication lag on the most recent 18 months, family-counting caveats, and any classification ambiguities._',
				'',
				'---',
				`*${DISCLAIMER}*`,
				'',
			].join('\n');

		case 'portfolio-due-diligence-memo':
			return [
				'# Portfolio Due Diligence Memorandum',
				'',
				fieldTable([['Target / Portfolio', f.subject], ['Transaction / Purpose', f.matter], ['Date', f.date], ['Prepared By', f.preparedBy]]),
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
