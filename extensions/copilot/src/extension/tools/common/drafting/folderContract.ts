/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The folder contract of Application Drafting (PRD 0020):
 *
 * ```
 * style/                                 workspace-level style exemplars (voice only, never a source)
 * drafting/<matter>/
 *   feature-list.md                      Feature List; frontmatter: office, confirmed
 *   figures.md                           figure list with parts and reference numerals
 *   claims.md                            Approved Claims; frontmatter: approved
 *   draft-application.md                 Draft Application; frontmatter: office, model, provider, version
 *   draft-application.generated.md       snapshot at generation, diffed at export
 *   draft-application.working-record.md  Working Record
 *   findings.md                          Findings, waivers with reasons, open Inventor Questions
 *   draft-application.docx               export, markers stripped
 * ```
 *
 * All paths are workspace-relative and use `/`.
 */

/** The workspace-level folder of style exemplars. */
export const DRAFTING_STYLE_FOLDER = 'style';

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
	readonly docx: string;
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
		featureList: `${folder}/feature-list.md`,
		figures: `${folder}/figures.md`,
		claims: `${folder}/claims.md`,
		draft: `${folder}/draft-application.md`,
		generatedSnapshot: `${folder}/draft-application.generated.md`,
		workingRecord: `${folder}/draft-application.working-record.md`,
		findings: `${folder}/findings.md`,
		docx: `${folder}/draft-application.docx`,
	};
}
