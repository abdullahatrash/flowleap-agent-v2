/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The Working Record of a Draft Application (`draft-application.working-record.md`, ADR 0012
 * decision 6): a header with the draft's provenance, the paragraph source map, and, after an
 * export, the attorney's edits against the generated snapshot.
 *
 * ```
 * # Working record — <matter>
 *
 * Companion to [draft-application.md](draft-application.md) ...
 *
 * ## Header
 *
 * - **Matter:** hinge
 * - **Approved claims SHA-256:** 9f2c...
 *
 * ## Source map
 * ...
 * ## Attorney edits
 * ...
 * ```
 *
 * Header fields are `- **<label>:** <value>` lines, read and replaced by label.
 */

import { DraftDiff } from './draftDiff';
import { INVENTOR_QUESTION } from './finding';
import { DRAFTING_FILE_NAMES } from './folderContract';
import { DraftSource, parseDraftParagraphs } from './sourceMarkers';
import { isClaimsParagraph } from './specValidators';

/** The hash of `claims.md` (body only) recorded when `start_application_draft` passed the gates. */
export const APPROVED_CLAIMS_HASH = 'Approved claims SHA-256';

/** The hash of the claims the saved draft version was generated against. */
export const VERSION_CLAIMS_HASH = 'Claims SHA-256 of this version';

/** When a tool cleared `approved` because `claims.md` changed after approval. */
export const APPROVAL_CLEARED = 'Approval cleared';

/** When a later save of the same draft version refreshed the source map. */
const RESAVED = 'Re-saved';

const draftFileName = DRAFTING_FILE_NAMES.draft;

/** The provenance of one saved Draft Application version. */
export interface DraftRecordHeader {
	readonly matter: string;
	readonly office: string;
	readonly model: string;
	readonly provider: string;
	readonly version: number;
	readonly disclosureVersion?: string;
	readonly promptsSummary?: string;
	readonly savedAt: string;
	readonly approvedClaimsHash?: string;
	readonly versionClaimsHash?: string;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function oneLine(text: string): string {
	return text.replace(/\s*\n\s*/g, ' ').trim();
}

function fieldLine(label: string, value: string): string {
	return `- **${label}:** ${oneLine(value)}`;
}

function fieldPattern(label: string): RegExp {
	return new RegExp(`^- \\*\\*${escapeRegExp(label)}:\\*\\* (?<value>.*)$`, 'm');
}

/** The record a tool starts when no record exists yet: title, companion line, empty header. */
export function emptyWorkingRecord(matter: string): string {
	return [
		`# Working record — ${matter}`,
		'',
		`Companion to [${draftFileName}](${encodeURIComponent(draftFileName)}): how this Draft Application was made. Internal; not part of the filed application.`,
		'',
		'## Header',
		'',
	].join('\n');
}

/** Reads one header field of a record by its label. */
export function readRecordField(record: string, label: string): string | undefined {
	return fieldPattern(label).exec(record)?.groups?.value.trim() || undefined;
}

/** Reads every header line of a record with this label, in order (e.g. each `Approval cleared`). */
export function readRecordFields(record: string, label: string): string[] {
	const pattern = new RegExp(fieldPattern(label).source, 'gm');
	return [...record.matchAll(pattern)].map(match => match.groups?.value.trim() ?? '').filter(Boolean);
}

/**
 * Sets one header field of a record: replaces the line with this label, or adds it at the end
 * of the `## Header` section (which is added when the record has none).
 */
export function setRecordField(record: string, label: string, value: string): string {
	const line = fieldLine(label, value);
	const pattern = fieldPattern(label);
	if (pattern.test(record)) {
		return record.replace(pattern, () => line);
	}
	return addRecordLine(record, label, value);
}

/**
 * Adds one header line to a record at the end of the `## Header` section (which is added when the
 * record has none), keeping the lines with the same label: for events such as `Approval cleared`.
 */
export function addRecordLine(record: string, label: string, value: string): string {
	const line = fieldLine(label, value);
	const lines = record.replace(/\r\n/g, '\n').split('\n');
	const header = lines.findIndex(content => /^##\s+Header\s*$/.test(content));
	if (header < 0) {
		return `${record.trimEnd()}\n\n## Header\n\n${line}\n`;
	}
	let end = header + 1;
	while (end < lines.length && !/^##\s/.test(lines[end])) {
		end++;
	}
	let insertAt = end;
	while (insertAt > header + 1 && !lines[insertAt - 1].trim()) {
		insertAt--;
	}
	if (insertAt === header + 1) {
		lines.splice(insertAt, 0, '', line);
	} else {
		lines.splice(insertAt, 0, line);
	}
	return lines.join('\n');
}

function sourceLabel(sources: readonly DraftSource[] | undefined): string {
	return sources?.length ? sources.map(source => source.ref ? `${source.kind}:${source.ref}` : source.kind).join(', ') : 'none';
}

/** Text as one table cell: one line, pipes escaped. */
function cell(text: string): string {
	return oneLine(text).replace(/\|/g, '\\|');
}

function excerpt(text: string): string {
	const flat = cell(text);
	return flat.length > 100 ? `${flat.slice(0, 97)}...` : flat;
}

/** Abbreviations whose period does not end a sentence (compared case-insensitively). */
const abbreviations = new Set(['fig', 'figs', 'no', 'nos', 'e.g', 'i.e', 'approx', 'ca', 'cf', 'vs', 'etc', 'et al', 'al', 'ref', 'refs', 'eq', 'para']);

/**
 * Splits a paragraph into sentences: a sentence ends at `.`, `?` or `!` followed by white space or
 * the end of the text. A period after a common abbreviation ("FIG.", "No.", "e.g.", "i.e.",
 * "approx.") does not end a sentence.
 */
export function splitSentences(text: string): string[] {
	const flat = oneLine(text);
	const sentences: string[] = [];
	let start = 0;
	for (const match of flat.matchAll(/[.?!](?=\s|$)/g)) {
		const end = (match.index ?? 0) + 1;
		if (match[0] === '.') {
			const word = /(?<word>[A-Za-z]+(?:\.[A-Za-z]+)*)\.$/.exec(flat.slice(start, end))?.groups?.word.toLowerCase();
			if (word && abbreviations.has(word)) {
				continue;
			}
		}
		sentences.push(flat.slice(start, end).trim());
		start = end;
	}
	const rest = flat.slice(start).trim();
	return [...sentences, ...(rest ? [rest] : [])].filter(Boolean);
}

/** The `## Source map` section: one row per sentence, with the sources of its paragraph. */
function sourceMapSection(draft: string): string {
	const rows = parseDraftParagraphs(draft)
		.filter(paragraph => paragraph.kind !== 'heading')
		.flatMap(paragraph => {
			const section = cell(paragraph.section ?? '');
			if (paragraph.kind === INVENTOR_QUESTION) {
				return [`| ${paragraph.line} | ${section} | Inventor Question | ${cell(paragraph.text)} |`];
			}
			if (isClaimsParagraph(paragraph) && !paragraph.sources) {
				return [`| ${paragraph.line} | ${section} | Approved Claims | ${excerpt(paragraph.text)} |`];
			}
			const sources = sourceLabel(paragraph.sources);
			return splitSentences(paragraph.text).map(sentence => `| ${paragraph.line} | ${section} | ${sources} | ${cell(sentence)} |`);
		});
	return [
		'## Source map',
		'',
		'Each sentence of the draft as saved, at the line of its paragraph, with the sources the paragraph marker names. "none" means the paragraph has no valid marker; the claims carry none, they are the Approved Claims.',
		'',
		'| Line | Section | Sources | Sentence |',
		'| --- | --- | --- | --- |',
		...rows,
		'',
	].join('\n');
}

/**
 * Renders the Working Record of the first save of a Draft Application version: the header and
 * the sentence-level source map.
 */
export function renderDraftWorkingRecord(header: DraftRecordHeader, draft: string): string {
	const fields: [string, string | number | undefined][] = [
		['Matter', header.matter],
		['Office', header.office],
		['Model', header.model],
		['Provider', header.provider],
		['Version', header.version],
		['Disclosure version', header.disclosureVersion],
		['Prompts', header.promptsSummary],
		['Saved', header.savedAt],
		[APPROVED_CLAIMS_HASH, header.approvedClaimsHash],
		[VERSION_CLAIMS_HASH, header.versionClaimsHash],
	];
	return [
		emptyWorkingRecord(header.matter).trimEnd(),
		'',
		...fields.filter((entry): entry is [string, string | number] => entry[1] !== undefined && String(entry[1]).trim() !== '').map(([label, value]) => fieldLine(label, String(value))),
		'',
		sourceMapSection(draft),
	].join('\n');
}

/**
 * The Working Record after a later save of the same draft version: the header (with its
 * `Approval cleared` lines) and the `## Attorney edits` section are kept, a `Re-saved` line is
 * added to the header, and the source map is refreshed from the saved draft.
 */
export function resaveWorkingRecord(record: string, draft: string, savedAt: string): string {
	const updated = addRecordLine(record.replace(/\r\n/g, '\n'), RESAVED, savedAt);
	const start = updated.search(/^## Source map\s*$/m);
	if (start < 0) {
		const edits = updated.search(/^## Attorney edits\s*$/m);
		return edits < 0
			? `${updated.trimEnd()}\n\n${sourceMapSection(draft)}`
			: `${updated.slice(0, edits).trimEnd()}\n\n${sourceMapSection(draft)}\n${updated.slice(edits)}`;
	}
	const next = updated.slice(start + 1).search(/^## /m);
	const after = next < 0 ? '' : updated.slice(start + 1 + next);
	return `${updated.slice(0, start)}${sourceMapSection(draft)}${after ? `\n${after}` : ''}`;
}

function quote(text: string): string {
	return text.split('\n').map(content => `> ${content}`).join('\n');
}

/**
 * Replaces the `## Attorney edits` section of a record (always the last section) with the diff
 * of the edited draft against the generated snapshot.
 */
export function withAttorneyEdits(record: string, diff: DraftDiff, exportedAt: string): string {
	const count = (kind: string) => diff.changes.filter(change => change.kind === kind).length;
	const section = [
		'## Attorney edits',
		'',
		`Exported ${exportedAt}. Against the generated snapshot: ${diff.kept} paragraph(s) kept, ${count('changed')} changed, ${count('deleted')} deleted, ${count('added')} added.`,
		...diff.changes.flatMap(change => [
			'',
			`### ${change.kind === 'changed' ? 'Changed' : change.kind === 'deleted' ? 'Deleted' : 'Added'}${change.line !== undefined ? ` (line ${change.line})` : ''}`,
			...(change.before !== undefined ? ['', `Generated (sources: ${sourceLabel(change.sources)}):`, '', quote(change.before)] : []),
			...(change.after !== undefined ? ['', 'Attorney:', '', quote(change.after)] : []),
		]),
		'',
	].join('\n');
	const start = record.search(/^## Attorney edits\s*$/m);
	const kept = start < 0 ? record : record.slice(0, start);
	return `${kept.trimEnd()}\n\n${section}`;
}
