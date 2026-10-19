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

/** One frontmatter field value as YAML parses it. */
export type DraftingFrontmatterValue = string | number | boolean | null | undefined | object;

/** Frontmatter fields as YAML parses them. */
export type DraftingFrontmatterFields = Record<string, DraftingFrontmatterValue>;

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

const topLevelFieldPattern = /^(?<field>[^\s#:'"][^:]*?)\s*:/;
const commentLinePattern = /^\s*#/;

/** The comment lines of a YAML block, each group under the top-level field that follows it. */
interface FrontmatterComments {
	readonly above: Map<string, string[]>;
	/** The comment lines after the last field. */
	readonly after: readonly string[];
}

function frontmatterComments(block: string): FrontmatterComments {
	const above = new Map<string, string[]>();
	let pending: string[] = [];
	for (const line of block.split('\n')) {
		if (commentLinePattern.test(line)) {
			pending.push(line);
			continue;
		}
		const field = topLevelFieldPattern.exec(line)?.groups?.field;
		if (field !== undefined) {
			above.set(field, pending);
			pending = [];
		}
	}
	return { above, after: pending };
}

/**
 * Writes `fields` as the frontmatter of `text`, in the key order of `fields`.
 * An existing frontmatter block of `text` is replaced, not merged. Its full comment lines stay:
 * each comment stays above the field it was above. A comment above a field that `fields` does not
 * have goes after the fields. An end-of-line comment is not kept.
 */
export function writeDraftingFrontmatter(fields: DraftingFrontmatterFields, text: string): string {
	const { body, bodyStartLine } = parseDraftingFrontmatter(text);
	const block = bodyStartLine > 1 ? frontmatterPattern.exec(text.replace(/\r\n/g, '\n'))?.groups?.yaml : undefined;
	const comments = frontmatterComments(block ?? '');
	const defined = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
	const lines: string[] = [];
	for (const line of yaml.stringify(defined).trimEnd().split('\n')) {
		const field = topLevelFieldPattern.exec(line)?.groups?.field;
		if (field !== undefined) {
			lines.push(...comments.above.get(field) ?? []);
			comments.above.delete(field);
		}
		lines.push(line);
	}
	lines.push(...[...comments.above.values()].flat(), ...comments.after);
	return `---\n${lines.join('\n')}\n---\n${body}`;
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

/**
 * The editor command of the gate CodeLens: it writes the gate flag of the file the attorney
 * clicked. It is not a tool, and `run_vscode_command` refuses it: the model never writes a gate flag.
 */
export const DRAFTING_GATE_COMMAND_ID = 'flowleap.drafting.setGateFlag';

/**
 * The editor-title commands of the two gates: "Confirm Feature List" on `feature-list.md` and
 * "Approve Claims" on `claims.md`, also in the markdown preview, where no CodeLens shows (#784).
 * They write the same flag line as {@link DRAFTING_GATE_COMMAND_ID}; `run_vscode_command`
 * refuses them too.
 */
export const DRAFTING_GATE_BUTTON_COMMAND_IDS: Readonly<Record<DraftingGateFlag, string>> = {
	confirmed: 'flowleap.drafting.confirmFeatureList',
	approved: 'flowleap.drafting.approveClaims',
};
