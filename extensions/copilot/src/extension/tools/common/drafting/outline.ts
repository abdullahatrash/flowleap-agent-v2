/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The Draft Outline (`draft-outline.md`) of a drafting matter (PRD 0022): the plan between the
 * Approved Claims and the Draft Application. It carries no technical text, only references.
 *
 * ```
 * ---
 * office: EPO
 * claims: <SHA-256 of the Approved Claims the plan was made from>
 * ---
 * # Draft Outline
 *
 * | Item | Section | Kind | Claims | Claim terms | Sources | Explain | Question |
 * |------|---------|------|--------|-------------|---------|---------|----------|
 * | O1 | Technical Field | Template |  |  |  | no |  |
 * | O2 | Detailed Description | Technical | 1, 3 | a sealing ring | F3, §2.1, FIG. 2 | yes |  |
 * | O3 | Detailed Description | Technical | 1, 2 | a spring |  | yes | What is the spring made of? |
 * ```
 *
 * One row per Outline Item, in draft order:
 *
 * - `Item`: `O1`, `O2`, ...; a draft paragraph names the item it realises with `item:O2` in its
 *   source marker.
 * - `Section`: a section name of the office order.
 * - `Kind`: `Template` (standard section text) or `Technical` (a concept of the claims).
 * - `Claims`: the claim numbers the item realises; a dependent claim is listed with the
 *   independent claim it depends on (`1, 3`).
 * - `Claim terms`: the claim terms the item explains, as the claims introduce them, comma-separated.
 * - `Sources`: comma-separated; a Feature List row `F3`, a disclosure span `§2.1`, a figure
 *   `FIG. 2`, an answered Inventor Question `IQ-4`. Empty only when `Question` is filled.
 * - `Explain`: `yes` when the item needs a mechanism, parameter or example, `no` for a statement.
 * - `Question`: the open question of a Technical item without a source.
 *
 * A `|` inside a cell is written `\|`.
 */

import { DRAFTING_FILE_NAMES } from './folderContract';
import { DraftingOffice, parseDraftingFrontmatter, readOffice, writeDraftingFrontmatter } from './frontmatter';
import { figureNamePattern } from './specValidators';

/** The columns of the Outline table, in order. */
export const OUTLINE_COLUMNS = ['Item', 'Section', 'Kind', 'Claims', 'Claim terms', 'Sources', 'Explain', 'Question'] as const;

/** The kind of an Outline Item: standard section text, or a concept of the claims. */
export type OutlineItemKind = 'Template' | 'Technical';

/**
 * The kind of a source an Outline Item names: a Feature List row (`F3`), a disclosure span
 * (`§2.1`), a figure (`FIG. 2`) or an answered Inventor Question (`IQ-4`).
 */
export type OutlineSourceKind = 'feature' | 'disclosure' | 'figure' | 'answer';

/** One source an Outline Item names. `ref` is `F3`, `§2.1`, the figure number `2`, or `IQ-4`. */
export interface OutlineSource {
	readonly kind: OutlineSourceKind;
	readonly ref: string;
}

/** One row of the Draft Outline. */
export interface OutlineItem {
	/** `O1`, `O2`, ... */
	readonly id: string;
	/** The 1-based line of the row in `draft-outline.md`. */
	readonly line: number;
	readonly section: string;
	readonly kind: OutlineItemKind;
	readonly claims: readonly number[];
	/** The claim terms as written in the row (`a sealing ring`). */
	readonly claimTerms: readonly string[];
	readonly sources: readonly OutlineSource[];
	readonly explain: boolean;
	/** The open question; absent when the cell is empty. */
	readonly question?: string;
}

/** A line of `draft-outline.md` that could not be read. */
export interface OutlineParseError {
	readonly line: number;
	readonly message: string;
}

/**
 * A parsed Draft Outline. A row with a parse error is left out of `items`; its error is in
 * `errors`.
 */
export interface DraftOutline {
	/** The `office` field; absent when it is not US or EPO. */
	readonly office?: DraftingOffice;
	/** The `claims` field: the SHA-256 of the Approved Claims; absent when it is not a string. */
	readonly claimsHash?: string;
	/** The 1-based line of the table header; absent when there is no Outline table. */
	readonly tableLine?: number;
	readonly items: readonly OutlineItem[];
	readonly errors: readonly OutlineParseError[];
}

/** What {@link writeDraftOutline} writes. The `line` of each item is ignored. */
export interface DraftOutlineContent {
	readonly office: DraftingOffice;
	readonly claimsHash: string;
	readonly items: readonly OutlineItem[];
}

const outlineFile = DRAFTING_FILE_NAMES.draftOutline;
const columnList = OUTLINE_COLUMNS.join(' | ');
const figureSourcePattern = new RegExp(`^(?:${figureNamePattern.source})$`);

/** The cells of a table row; `\|` is a pipe inside a cell. */
function readCells(content: string): string[] {
	const inner = content.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
	return inner.split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
}

function isHeader(content: string): boolean {
	return content.trim().startsWith('|') && readCells(content).map(cell => cell.toLowerCase()).join('|') === OUTLINE_COLUMNS.map(column => column.toLowerCase()).join('|');
}

function list(cell: string): string[] {
	return cell.split(',').map(entry => entry.trim()).filter(Boolean);
}

/** Reads one entry of the `Sources` cell, or `undefined` when it names no known kind of source. */
function readSource(entry: string): OutlineSource | undefined {
	if (/^F\d+$/.test(entry)) {
		return { kind: 'feature', ref: entry };
	}
	if (/^§\s*\S+$/.test(entry)) {
		return { kind: 'disclosure', ref: entry };
	}
	if (/^IQ-\d+$/.test(entry)) {
		return { kind: 'answer', ref: entry };
	}
	const figure = figureSourcePattern.test(entry) ? /(?<number>\d+[a-zA-Z]?)$/.exec(entry)?.groups?.number : undefined;
	return figure ? { kind: 'figure', ref: figure } : undefined;
}

/** Reads one table row into an item, or into the errors of the row. */
function readRow(cells: readonly string[], line: number): { readonly item?: OutlineItem; readonly errors: OutlineParseError[] } {
	const [id, section, kind, claims, claimTerms, sources, explain, question] = cells;
	const errors: OutlineParseError[] = [];
	const error = (message: string) => errors.push({ line, message });
	const label = /^O\d+$/.test(id) ? `Item ${id}` : undefined;
	if (!label) {
		error(`Item "${id}" is not an Outline Item id (O1, O2, ...).`);
	}
	const prefix = label ? `${label}: ` : '';
	if (kind !== 'Template' && kind !== 'Technical') {
		error(`${prefix}Kind "${kind}" is not Template or Technical.`);
	}
	const claimNumbers = list(claims);
	if (claimNumbers.some(entry => !/^\d+$/.test(entry))) {
		error(`${prefix}Claims "${claims}" is not a list of claim numbers (1, 3).`);
	}
	const explainValue = explain.toLowerCase();
	if (explainValue !== 'yes' && explainValue !== 'no') {
		error(`${prefix}Explain "${explain}" is not yes or no.`);
	}
	const readSources: OutlineSource[] = [];
	for (const entry of list(sources)) {
		const source = readSource(entry);
		if (source) {
			readSources.push(source);
		} else {
			error(`${prefix}source "${entry}" is not a Feature List row (F3), a disclosure span (§2.1), a figure (FIG. 2) or an Inventor Question (IQ-4).`);
		}
	}
	if (errors.length) {
		return { errors };
	}
	const item: OutlineItem = {
		id,
		line,
		section,
		kind: kind as OutlineItemKind,
		claims: claimNumbers.map(Number),
		claimTerms: list(claimTerms),
		sources: readSources,
		explain: explainValue === 'yes',
		...(question ? { question } : {}),
	};
	return { item, errors };
}

/**
 * Parses `draft-outline.md`: the `office` and `claims` frontmatter fields and the rows of the
 * Outline table. Line numbers refer to the whole file. A row with an error is reported in
 * `errors` and left out of `items`. A missing `claims` hash is not a parse error: the
 * `outline-claims` rule reports it.
 */
export function parseDraftOutline(text: string): DraftOutline {
	const { fields, body, bodyStartLine } = parseDraftingFrontmatter(text);
	const errors: OutlineParseError[] = [];
	const office = readOffice(fields);
	const claimsHash = typeof fields.claims === 'string' && fields.claims.trim() ? fields.claims.trim() : undefined;
	if (!office) {
		errors.push({ line: 1, message: 'The frontmatter names no office (office: US or office: EPO).' });
	}
	const lines = body.split('\n');
	const header = lines.findIndex(isHeader);
	if (header < 0) {
		errors.push({ line: bodyStartLine, message: `${outlineFile} has no Outline table with the columns ${columnList}.` });
		return { ...(office ? { office } : {}), ...(claimsHash ? { claimsHash } : {}), items: [], errors };
	}
	const items: OutlineItem[] = [];
	const seen = new Set<string>();
	for (let index = header + 1; index < lines.length && lines[index].trim().startsWith('|'); index++) {
		const content = lines[index];
		const line = bodyStartLine + index;
		if (index === header + 1 && /^\s*\|[\s:|-]*$/.test(content)) {
			continue;
		}
		const cells = readCells(content);
		if (cells.length !== OUTLINE_COLUMNS.length) {
			errors.push({ line, message: `The row has ${cells.length} cells; the Outline table has ${OUTLINE_COLUMNS.length} columns: ${columnList}.` });
			continue;
		}
		const id = cells[0];
		const duplicate = seen.has(id);
		seen.add(id);
		const row = readRow(cells, line);
		errors.push(...row.errors);
		if (duplicate) {
			errors.push({ line, message: `Item ${id} is listed more than once.` });
		} else if (row.item) {
			items.push(row.item);
		}
	}
	return { ...(office ? { office } : {}), ...(claimsHash ? { claimsHash } : {}), tableLine: bodyStartLine + header, items, errors };
}

function writeCell(text: string): string {
	return text.replace(/\|/g, '\\|');
}

function writeSource(source: OutlineSource): string {
	return source.kind === 'figure' ? `FIG. ${source.ref}` : source.ref;
}

/** Writes `draft-outline.md`: the frontmatter (`office`, `claims`) and the Outline table. */
export function writeDraftOutline(outline: DraftOutlineContent): string {
	const rows = outline.items.map(item => [
		item.id,
		item.section,
		item.kind,
		item.claims.join(', '),
		item.claimTerms.join(', '),
		item.sources.map(writeSource).join(', '),
		item.explain ? 'yes' : 'no',
		item.question ?? '',
	].map(cell => ` ${writeCell(cell)} `).join('|'));
	const body = [
		'# Draft Outline',
		'',
		`| ${columnList} |`,
		`|${OUTLINE_COLUMNS.map(column => '-'.repeat(column.length + 2)).join('|')}|`,
		...rows.map(row => `|${row}|`),
		'',
	].join('\n');
	return writeDraftingFrontmatter({ office: outline.office, claims: outline.claimsHash }, body);
}
