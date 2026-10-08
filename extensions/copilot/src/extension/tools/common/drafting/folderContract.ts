/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The folder contract of Application Drafting (PRD 0020):
 *
 * ```
 * style/                                 workspace-level style exemplars (voice only, never a source)
 *   README.md                            how to use the folder; written by the tools when missing, never an exemplar
 * drafting/<matter>/
 *   feature-list.md                      Feature List; frontmatter: office, confirmed
 *   figures.md                           figure list with parts and reference numerals
 *   claims.md                            Approved Claims; frontmatter: approved
 *   draft-application.md                 Draft Application; frontmatter: office, model, provider, version
 *   draft-application.generated.md       snapshot at generation, diffed at export
 *   draft-application.working-record.md  Working Record
 *   findings.md                          Findings, waivers with reasons, open Inventor Questions
 *   inventor-answers.md                  the inventor's answers to the Inventor Questions, one section each
 *   checklist.md                         Drafting Checklist, written by code after every drafting tool call
 *   draft-application.description.docx   export, markers stripped, one file per document type:
 *   draft-application.claims.docx          description, claims, abstract (drawings are not generated)
 *   draft-application.abstract.docx
 *   draft-application.full.docx          export: full review copy, the whole application in one file, not for filing
 *   filing-manifest.md                   export: claims, drawing sheets, abstract figure, estimated pages
 * ```
 *
 * All paths are workspace-relative and use `/`.
 */

/** The workspace-level folder of style exemplars. */
export const DRAFTING_STYLE_FOLDER = 'style';

/**
 * The document types of the export, in filing order. Each is its own .docx: in the EPO Online
 * Filing each is a separate upload, and each starts on a new page.
 */
export const DRAFT_DOCUMENT_TYPES = ['description', 'claims', 'abstract'] as const;

/** One document type of the export. */
export type DraftDocumentType = typeof DRAFT_DOCUMENT_TYPES[number];

/** The file names of one matter's drafting files in its folder; also the `file` of a Finding. */
export const DRAFTING_FILE_NAMES = {
	featureList: 'feature-list.md',
	figures: 'figures.md',
	claims: 'claims.md',
	draft: 'draft-application.md',
	generatedSnapshot: 'draft-application.generated.md',
	workingRecord: 'draft-application.working-record.md',
	findings: 'findings.md',
	inventorAnswers: 'inventor-answers.md',
	checklist: 'checklist.md',
	descriptionDocx: 'draft-application.description.docx',
	claimsDocx: 'draft-application.claims.docx',
	abstractDocx: 'draft-application.abstract.docx',
	fullReviewCopy: 'draft-application.full.docx',
	filingManifest: 'filing-manifest.md',
} as const;

/** The workspace-relative paths of one matter's drafting files. */
export interface DraftingFolder {
	readonly matter: string;
	readonly folder: string;
	readonly featureList: string;
	readonly figures: string;
	readonly claims: string;
	readonly draft: string;
	readonly generatedSnapshot: string;
	readonly workingRecord: string;
	readonly findings: string;
	readonly inventorAnswers: string;
	readonly checklist: string;
	/** The export, one .docx per document type. */
	readonly docx: Readonly<Record<DraftDocumentType, string>>;
	/** The full review copy written beside the export: the whole application in one file, not for filing. */
	readonly fullReviewCopy: string;
	/** The filing manifest written beside the export. */
	readonly filingManifest: string;
}

/**
 * Resolves the drafting folder of a matter. Returns `undefined` when the matter name is empty,
 * starts with a dot, or contains a path separator (the folder must stay under `drafting/`).
 */
export function resolveDraftingFolder(matter: string): DraftingFolder | undefined {
	const name = matter.trim();
	if (!name || name.startsWith('.') || /[\/\\]/.test(name)) {
		return undefined;
	}
	const folder = `drafting/${name}`;
	return {
		matter: name,
		folder,
		featureList: `${folder}/${DRAFTING_FILE_NAMES.featureList}`,
		figures: `${folder}/${DRAFTING_FILE_NAMES.figures}`,
		claims: `${folder}/${DRAFTING_FILE_NAMES.claims}`,
		draft: `${folder}/${DRAFTING_FILE_NAMES.draft}`,
		generatedSnapshot: `${folder}/${DRAFTING_FILE_NAMES.generatedSnapshot}`,
		workingRecord: `${folder}/${DRAFTING_FILE_NAMES.workingRecord}`,
		findings: `${folder}/${DRAFTING_FILE_NAMES.findings}`,
		inventorAnswers: `${folder}/${DRAFTING_FILE_NAMES.inventorAnswers}`,
		checklist: `${folder}/${DRAFTING_FILE_NAMES.checklist}`,
		docx: {
			description: `${folder}/${DRAFTING_FILE_NAMES.descriptionDocx}`,
			claims: `${folder}/${DRAFTING_FILE_NAMES.claimsDocx}`,
			abstract: `${folder}/${DRAFTING_FILE_NAMES.abstractDocx}`,
		},
		fullReviewCopy: `${folder}/${DRAFTING_FILE_NAMES.fullReviewCopy}`,
		filingManifest: `${folder}/${DRAFTING_FILE_NAMES.filingManifest}`,
	};
}

/**
 * The matter of a workspace-relative Draft Application path (`drafting/<matter>/draft-application.md`),
 * or `undefined` for any other path and for a matter name {@link resolveDraftingFolder} refuses.
 */
export function matchDraftPath(path: string): string | undefined {
	const [top, matter, file, ...rest] = path.split('/');
	if (top !== 'drafting' || file !== DRAFTING_FILE_NAMES.draft || rest.length || matter === undefined) {
		return undefined;
	}
	return resolveDraftingFolder(matter)?.matter === matter ? matter : undefined;
}
