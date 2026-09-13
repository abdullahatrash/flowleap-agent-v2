/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure helpers for the `.prompt.md` files behind the FlowLeap Prompts view (PRD 0014).
 *
 * A prompt file is YAML-ish front matter (`name`, `description`) followed by the prompt body —
 * the same shape core reads for `contributes.chatPromptFiles`, so one file doubles as a `/name`
 * slash command and as a library entry. This module stays free of `vscode` so the parsing,
 * slugging and labelling rules can be unit-tested on their own.
 */

/** Prefix every bundled FlowLeap prompt carries, so its slash command is namespaced. */
export const BUNDLED_PROMPT_PREFIX = 'flowleap-';

/** One parsed prompt file. `body` is exactly what the Copy action puts on the clipboard. */
export interface ParsedPromptFile {
	readonly name: string;
	readonly description: string;
	readonly body: string;
}

/** Strip one layer of matching quotes from a front-matter scalar. */
function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2 && (trimmed.startsWith('"') && trimmed.endsWith('"') || trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/**
 * Parse a `.prompt.md` file into its name, description and body.
 *
 * A file without front matter is still a usable prompt: the whole text becomes the body and the
 * file stem stands in for the missing name. Unknown front-matter keys (`agent`, `argument-hint`,
 * …) are ignored rather than rejected — core owns that schema, this view only needs three fields.
 *
 * @param text Raw file contents.
 * @param fileStem File name without the `.prompt.md` suffix, used when front matter has no `name`.
 */
export function parsePromptFile(text: string, fileStem: string): ParsedPromptFile {
	const normalized = text.replace(/\r\n/g, '\n');
	const match = /^---\n([\s\S]*?)\n---[ \t]*\n?([\s\S]*)$/.exec(normalized);
	if (!match) {
		return { name: fileStem, description: '', body: normalized.trim() };
	}

	const [, frontMatter, body] = match;
	let name = '';
	let description = '';
	for (const line of frontMatter.split('\n')) {
		const separator = line.indexOf(':');
		if (separator === -1) {
			continue;
		}
		const key = line.slice(0, separator).trim();
		const value = unquote(line.slice(separator + 1));
		if (key === 'name') {
			name = value;
		} else if (key === 'description') {
			description = value;
		}
	}

	return { name: name || fileStem, description, body: body.trim() };
}

/**
 * Display labels for the bundled prompts. A slug cannot say which of its hyphens joins a compound
 * term ("prior-art") and which separates words, so the eight shipped names are spelled out and
 * everything else falls back to the generic rule.
 */
const BUNDLED_PROMPT_LABELS = new Map<string, string>([
	['flowleap-prior-art-search', 'Prior-art search'],
	['flowleap-claim-analysis', 'Claim analysis'],
	['flowleap-freedom-to-operate', 'Freedom-to-operate'],
	['flowleap-patent-landscape', 'Patent landscape'],
	['flowleap-invalidity-analysis', 'Invalidity analysis'],
	['flowleap-office-action-response', 'Office-action response'],
	['flowleap-patent-dossier', 'Patent dossier'],
	['flowleap-literature-review', 'Literature review'],
]);

/**
 * Turn a prompt `name` into a tree label: the shipped labels verbatim, otherwise the slug with its
 * `flowleap-` prefix dropped, hyphens opened up, and the first letter capitalised.
 */
export function humanisePromptName(name: string): string {
	const known = BUNDLED_PROMPT_LABELS.get(name);
	if (known) {
		return known;
	}
	const stripped = name.startsWith(BUNDLED_PROMPT_PREFIX) ? name.slice(BUNDLED_PROMPT_PREFIX.length) : name;
	const spaced = stripped.replace(/[-_]+/g, ' ').trim();
	if (!spaced) {
		return name;
	}
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Turn a user-typed title into a file-name-safe slug. Empty input falls back to `prompt`. */
export function slugifyPromptTitle(title: string): string {
	const slug = title
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return slug || 'prompt';
}

/**
 * Pick a slug that no existing prompt owns, appending `-2`, `-3`, … until one is free.
 *
 * @param base Slug from {@link slugifyPromptTitle}.
 * @param existing Slugs already in use.
 */
export function uniquePromptSlug(base: string, existing: readonly string[]): string {
	const taken = new Set(existing);
	if (!taken.has(base)) {
		return base;
	}
	for (let suffix = 2; ; suffix++) {
		const candidate = `${base}-${suffix}`;
		if (!taken.has(candidate)) {
			return candidate;
		}
	}
}

/**
 * Order the bundled prompts the way the PRD lists them — the prior-art search leads, because it is
 * the one users run most — and sort anything unknown alphabetically behind them.
 */
export function compareBundledPromptNames(a: string, b: string): number {
	const order = [...BUNDLED_PROMPT_LABELS.keys()];
	const rankA = order.indexOf(a);
	const rankB = order.indexOf(b);
	if (rankA !== -1 || rankB !== -1) {
		return (rankA === -1 ? order.length : rankA) - (rankB === -1 ? order.length : rankB);
	}
	return humanisePromptName(a).localeCompare(humanisePromptName(b));
}
