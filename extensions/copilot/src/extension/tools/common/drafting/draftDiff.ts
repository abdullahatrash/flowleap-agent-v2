/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Paragraph-level diff of the edited Draft Application against the generated snapshot
 * (`draft-application.generated.md`). The Working Record logs each change: what the model
 * proposed, what the attorney kept, changed or deleted (ADR 0012 decision 6).
 */

import { LcsDiff } from '../../../../util/vs/base/common/diff/diff';
import { DraftParagraph, DraftSource, parseDraftParagraphs } from './sourceMarkers';

/** One paragraph the attorney changed, deleted or added. */
export interface DraftParagraphChange {
	readonly kind: 'changed' | 'deleted' | 'added';
	/** The generated paragraph text (absent for `added`). */
	readonly before?: string;
	/** The edited paragraph text (absent for `deleted`). */
	readonly after?: string;
	/** The 1-based line of the edited paragraph (absent for `deleted`). */
	readonly line?: number;
	/** The sources of the generated paragraph. */
	readonly sources?: readonly DraftSource[];
}

/** The result of a draft diff: the number of paragraphs kept unchanged, and the changes. */
export interface DraftDiff {
	readonly kept: number;
	readonly changes: readonly DraftParagraphChange[];
}

function normalize(paragraph: DraftParagraph): string {
	return paragraph.text.replace(/\s+/g, ' ').trim();
}

/**
 * Diffs an edited draft against the generated snapshot, paragraph by paragraph. Frontmatter,
 * markers and whitespace inside a paragraph are ignored.
 */
export function diffDraftParagraphs(generated: string, edited: string): DraftDiff {
	const before = parseDraftParagraphs(generated);
	const after = parseDraftParagraphs(edited);
	const beforeTexts = before.map(normalize);
	const afterTexts = after.map(normalize);
	const diff = new LcsDiff({ getElements: () => beforeTexts }, { getElements: () => afterTexts }).ComputeDiff(false);
	const changes: DraftParagraphChange[] = [];
	let changedParagraphs = 0;
	for (const change of diff.changes) {
		const paired = Math.min(change.originalLength, change.modifiedLength);
		changedParagraphs += change.originalLength;
		for (let i = 0; i < Math.max(change.originalLength, change.modifiedLength); i++) {
			const original = i < change.originalLength ? before[change.originalStart + i] : undefined;
			const modified = i < change.modifiedLength ? after[change.modifiedStart + i] : undefined;
			const kind = i < paired ? 'changed' : original ? 'deleted' : 'added';
			changes.push({
				kind,
				...(original ? { before: original.text } : {}),
				...(modified ? { after: modified.text, line: modified.line } : {}),
				...(original?.sources ? { sources: original.sources } : {}),
			});
		}
	}
	return { kept: before.length - changedParagraphs, changes };
}
