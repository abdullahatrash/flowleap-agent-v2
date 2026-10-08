/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The workspace `style/` folder of Application Drafting: the attorney's own filed applications or
 * claim sets, read as style exemplars (voice and structure only, never facts). Every drafting tool
 * call creates the folder with a `README.md` that says how to use it, when the README is missing;
 * it never overwrites the README or any other file. The README is never an exemplar.
 */

import { DRAFTING_STYLE_FOLDER } from './folderContract';

/** At most this many style exemplars are read, in name order. */
export const MAX_STYLE_EXEMPLARS = 5;

/** The file name of the how-to in the style folder. */
export const STYLE_README = 'README.md';

/** The plain instruction for the style folder, in the README, the Drafting Checklist and the start result. */
export const STYLE_INSTRUCTION = `Put 1 to 5 of your own filed applications or claim sets in ${DRAFTING_STYLE_FOLDER}/ (.md, .docx, .pdf). FlowLeap copies their voice and structure only, never their facts. Leave the folder empty to use the office template style.`;

const exemplarExtensions = /\.(?:md|docx|pdf)$/i;

/** True for a file name of the style folder that is an exemplar: .md, .docx or .pdf, and not the README. */
export function isStyleExemplar(name: string): boolean {
	return exemplarExtensions.test(name) && name.toLowerCase() !== STYLE_README.toLowerCase();
}

/** The text of `style/README.md`. */
export function renderStyleReadme(): string {
	return [
		'# Style exemplars',
		'',
		STYLE_INSTRUCTION,
		'',
		`Only the first ${MAX_STYLE_EXEMPLARS} files, in name order, are read. This README is never read as an exemplar. FlowLeap does not change or delete any file in this folder.`,
		'',
	].join('\n');
}
