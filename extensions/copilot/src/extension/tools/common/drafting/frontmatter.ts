/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * YAML frontmatter of the Application Drafting artifacts (ADR 0012).
 *
 * - `feature-list.md`: `office` (US | EPO), `confirmed` (the attorney's gate before drafting).
 * - `claims.md`: `approved` (the attorney's gate before the specification is generated).
 * - `draft-application.md`: `office`, `model`, `provider`, `version`.
 *
 * A gate flag is set only when its value is the literal YAML boolean `true`. A quoted `"true"`
 * does not pass: the gate is read by code from the file, never inferred.
 */

import * as yaml from 'yaml';

/** The office a Draft Application is written for. */
export type DraftingOffice = 'US' | 'EPO';

/** A gate flag of the Application Drafting pipeline. */
export type DraftingGateFlag = 'confirmed' | 'approved';

/** The state of a gate flag: set (`true`), present but not `true`, or missing. */
export type DraftingGateState = 'set' | 'not-true' | 'missing';

/** Frontmatter field values as YAML parses them. */
export type DraftingFrontmatterFields = Record<string, string | number | boolean | null | undefined | object>;

/** A drafting artifact split into its frontmatter fields and its body. */
export interface ParsedDraftingFile {
	readonly fields: DraftingFrontmatterFields;
	/** The text after the frontmatter block (the whole text when there is no valid block). */
	readonly body: string;
	/** The 1-based line number in the file where `body` starts. */
	readonly bodyStartLine: number;
}

const frontmatterPattern = /^---\n(?<yaml>[\s\S]*?)\n?---[ \t]*(?:\n|$)/;

/**
 * Splits a drafting artifact into its YAML frontmatter fields and its body.
 * CRLF is normalised to LF. Text without a valid frontmatter block gives no fields.
 */
export function parseDraftingFrontmatter(text: string): ParsedDraftingFile {
	const normalized = text.replace(/\r\n/g, '\n');
	const match = frontmatterPattern.exec(normalized);
	if (!match?.groups) {
		return { fields: {}, body: normalized, bodyStartLine: 1 };
	}
	let fields: unknown;
	try {
		fields = yaml.parse(match.groups.yaml);
	} catch {
		return { fields: {}, body: normalized, bodyStartLine: 1 };
	}
	if (fields !== null && (typeof fields !== 'object' || Array.isArray(fields))) {
		return { fields: {}, body: normalized, bodyStartLine: 1 };
	}
	const block = match[0];
	const blockLines = block.endsWith('\n') ? block.split('\n').length - 1 : block.split('\n').length;
	return {
		fields: (fields ?? {}) as DraftingFrontmatterFields,
		body: normalized.slice(block.length),
		bodyStartLine: blockLines + 1,
	};
}

/**
 * Writes `fields` as the frontmatter of `text`, in the key order of `fields`.
 * An existing frontmatter block of `text` is replaced, not merged.
 */
export function writeDraftingFrontmatter(fields: DraftingFrontmatterFields, text: string): string {
	const { body } = parseDraftingFrontmatter(text);
	const defined = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
	return `---\n${yaml.stringify(defined).trimEnd()}\n---\n${body}`;
}

/** Reads a gate flag. Only the literal boolean `true` is `'set'`. */
export function readGateFlag(fields: DraftingFrontmatterFields, flag: DraftingGateFlag): DraftingGateState {
	if (!(flag in fields) || fields[flag] === undefined || fields[flag] === null) {
		return 'missing';
	}
	return fields[flag] === true ? 'set' : 'not-true';
}

/** Reads the `office` field (case-insensitive). Any value other than US or EPO gives `undefined`. */
export function readOffice(fields: DraftingFrontmatterFields): DraftingOffice | undefined {
	const office = fields.office;
	if (typeof office !== 'string') {
		return undefined;
	}
	const upper = office.trim().toUpperCase();
	return upper === 'US' || upper === 'EPO' ? upper : undefined;
}
