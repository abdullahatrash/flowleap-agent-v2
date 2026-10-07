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
import { DraftSource, parseDraftParagraphs } from './sourceMarkers';
import { isClaimsParagraph } from './specValidators';

/** The hash of `claims.md` (body only) recorded when `start_application_draft` passed the gates. */
export const APPROVED_CLAIMS_HASH = 'Approved claims SHA-256';

/** The hash of the claims the saved draft version was generated against. */
export const VERSION_CLAIMS_HASH = 'Claims SHA-256 of this version';

/** When a tool cleared `approved` because `claims.md` changed after approval. */
export const APPROVAL_CLEARED = 'Approval cleared';

const draftFileName = 'draft-application.md';

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

function excerpt(text: string): string {
	const flat = oneLine(text).replace(/\|/g, '\\|');
	return flat.length > 100 ? `${flat.slice(0, 97)}...` : flat;
}

/**
 * Renders the Working Record of a saved Draft Application: the header and the source map of
 * every paragraph (line, section, sources, opening words).
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
	const rows = parseDraftParagraphs(draft)
		.filter(paragraph => paragraph.kind !== 'heading')
		.map(paragraph => `| ${paragraph.line} | ${excerpt(paragraph.section ?? '')} | ${paragraph.kind === 'inventor-question' ? 'Inventor Question' : isClaimsParagraph(paragraph) && !paragraph.sources ? 'Approved Claims' : sourceLabel(paragraph.sources)} | ${excerpt(paragraph.text)} |`);
	return [
		emptyWorkingRecord(header.matter).trimEnd(),
		'',
		...fields.filter((entry): entry is [string, string | number] => entry[1] !== undefined && String(entry[1]).trim() !== '').map(([label, value]) => fieldLine(label, String(value))),
		'',
		'## Source map',
		'',
		'Each paragraph of the draft as saved, with the source its marker names. "none" means the paragraph has no valid marker; the claims carry none, they are the Approved Claims.',
		'',
		'| Line | Section | Sources | Paragraph |',
		'| --- | --- | --- | --- |',
		...rows,
		'',
	].join('\n');
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
