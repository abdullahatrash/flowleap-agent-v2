/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The findings file (`findings.md`) of a draft. Sections: Errors, Inventor Questions, Notes,
 * Advisory. One item per line:
 *
 * ```
 * - `antecedent-basis` (claims.md, line 3, claim 3): Claim 3: "the spring" has no antecedent basis ...
 *   - Waived: Spring is inherent in the hinge type.
 * ```
 *
 * The attorney waives an Error or an Inventor Question by adding the `  - Waived: <reason>`
 * line. A waiver without a reason is ignored. Waivers are kept across validator runs
 * (ADR 0012 decision 5).
 */

import { DIAGRAM_RULES, DRAWING_RULES } from './figureRules';
import { DraftFinding, isInventorQuestion } from './finding';

const sections: readonly { heading: string; severity: DraftFinding['severity']; accepts: (finding: DraftFinding) => boolean }[] = [
	{ heading: 'Errors', severity: 'Error', accepts: finding => finding.severity === 'Error' && !isInventorQuestion(finding) },
	{ heading: 'Inventor Questions', severity: 'Error', accepts: finding => finding.severity === 'Error' && isInventorQuestion(finding) },
	{ heading: 'Notes', severity: 'Note', accepts: finding => finding.severity === 'Note' },
	{ heading: 'Advisory', severity: 'Advisory', accepts: finding => finding.severity === 'Advisory' },
];

const itemPattern = /^- `(?<rule>[^`]+)`(?: \((?<location>[^)]*)\))?: (?<message>.*)$/;
const waiverPattern = /^\s+- Waived:\s*(?<reason>.*?)\s*$/;

function oneLine(text: string): string {
	return text.replace(/\s*\n\s*/g, ' ').trim();
}

function renderItem(finding: DraftFinding): string[] {
	const location = [finding.file, finding.line !== undefined ? `line ${finding.line}` : undefined, finding.claim !== undefined ? `claim ${finding.claim}` : undefined, finding.question].filter(Boolean).join(', ');
	const item = `- \`${finding.rule}\`${location ? ` (${location})` : ''}: ${oneLine(finding.message)}`;
	return finding.waived ? [item, renderWaiverLine(finding.waived.reason)] : [item];
}

/** The waiver line under an item: `  - Waived: <reason>`, the reason on one line. */
function renderWaiverLine(reason: string): string {
	return `  - Waived: ${oneLine(reason)}`;
}

/** Renders `findings.md`. Each finding goes to the section of its severity. */
export function renderFindingsFile(findings: readonly DraftFinding[]): string {
	const lines = [
		'# Findings',
		'',
		'Errors and Inventor Questions block export until they are resolved or waived. To waive one, add a line `  - Waived: <reason>` under it. Notes never block. Advisory items come from the model review; they are advice, not a pass.',
	];
	for (const section of sections) {
		const items = findings.filter(section.accepts);
		lines.push('', `## ${section.heading}`, '', ...(items.length ? items.flatMap(renderItem) : ['None.']));
	}
	return lines.join('\n') + '\n';
}

/** One item of `findings.md` with the 1-based line of its item in that file. */
export interface FindingsFileItem {
	readonly finding: DraftFinding;
	readonly fileLine: number;
}

/** Parses `findings.md` with the line of each item, including the attorney's waivers. */
export function parseFindingsFileItems(text: string): FindingsFileItem[] {
	const items: { finding: DraftFinding; fileLine: number }[] = [];
	let severity: DraftFinding['severity'] | undefined;
	text.replace(/\r\n/g, '\n').split('\n').forEach((line, index) => {
		const heading = /^##\s+(?<title>.+?)\s*$/.exec(line);
		if (heading?.groups) {
			severity = sections.find(section => section.heading.toLowerCase() === heading.groups!.title.toLowerCase())?.severity;
			return;
		}
		if (!severity) {
			return;
		}
		const item = itemPattern.exec(line);
		if (item?.groups) {
			items.push({ finding: { severity, rule: item.groups.rule, message: item.groups.message.trim(), ...readLocation(item.groups.location) }, fileLine: index + 1 });
			return;
		}
		const waiver = waiverPattern.exec(line);
		const last = items.at(-1);
		if (waiver?.groups?.reason && last && !last.finding.waived) {
			last.finding = { ...last.finding, waived: { reason: waiver.groups.reason } };
		}
	});
	return items;
}

/**
 * The editor command of the waiver CodeLens on `findings.md`: it writes the waiver the attorney
 * typed under the items the attorney clicked. It is not a tool, and `run_vscode_command` refuses
 * it: the model never writes a waiver.
 */
export const DRAFTING_WAIVE_COMMAND_ID = 'flowleap.drafting.waiveFindings';

/** True for an Error item without a waiver. Inventor Questions are not included: the inventor answers them. */
export function isWaivableError(item: FindingsFileItem): boolean {
	return item.finding.severity === 'Error' && !isInventorQuestion(item.finding) && !item.finding.waived;
}

/** One waiver line to insert into `findings.md`, after the 1-based line `afterLine`. */
export interface FindingsWaiverInsertion {
	readonly afterLine: number;
	readonly text: string;
}

/**
 * The waiver lines that waive the items at the 1-based `fileLines` of `text` with `reason`.
 * Each line goes after the item and its indented sub-lines. An item that is not an unwaived
 * Error gets no line (the file changed after the click), and an empty reason gives no lines.
 */
export function findingsWaiverInsertions(text: string, fileLines: readonly number[], reason: string): FindingsWaiverInsertion[] {
	if (!oneLine(reason)) {
		return [];
	}
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const waivable = new Set(parseFindingsFileItems(text).filter(isWaivableError).map(item => item.fileLine));
	return [...new Set(fileLines)].filter(fileLine => waivable.has(fileLine)).sort((a, b) => a - b).map(fileLine => {
		let afterLine = fileLine;
		while (afterLine < lines.length && /^\s+\S/.test(lines[afterLine])) {
			afterLine++;
		}
		return { afterLine, text: renderWaiverLine(reason) };
	});
}

/** Parses `findings.md`, including the attorney's waivers. */
export function parseFindingsFile(text: string): DraftFinding[] {
	return parseFindingsFileItems(text).map(item => item.finding);
}

function readLocation(location: string | undefined): Pick<DraftFinding, 'file' | 'line' | 'claim' | 'question'> {
	const result: { file?: string; line?: number; claim?: number; question?: string } = {};
	for (const part of (location ?? '').split(',').map(entry => entry.trim()).filter(Boolean)) {
		const numbered = /^(?<kind>line|claim) (?<value>\d+)$/.exec(part);
		if (numbered?.groups) {
			result[numbered.groups.kind as 'line' | 'claim'] = Number(numbered.groups.value);
		} else if (/^IQ-\d+$/.test(part)) {
			result.question = part;
		} else {
			result.file = part;
		}
	}
	return result;
}

/** The identity of a finding across runs: rule, claim and message, with line numbers ignored. */
function findingKey(finding: DraftFinding): string {
	return `${finding.rule}|${finding.claim ?? ''}|${oneLine(finding.message).replace(/\bline \d+\b/gi, 'line #')}`;
}

/** The rule ids of the Figure checks of the Drawing Set (PRD 0023); no drafting validator emits them. */
const drawingRules: ReadonlySet<string> = new Set([...Object.keys(DRAWING_RULES), ...Object.keys(DIAGRAM_RULES)]);

/**
 * Merges a new validator run with the previous findings file: a current finding keeps the
 * waiver of the same finding in `previous` (same rule, claim and message; line numbers may
 * move). When `current` has no Advisory items, the Advisory items of `previous` are kept. A
 * waived item of a Drawing Set Figure check is kept too: the drafting validators never emit
 * those rules, and build_drawing_set reads the waiver.
 */
export function mergeFindings(current: readonly DraftFinding[], previous: readonly DraftFinding[]): DraftFinding[] {
	const waivers = new Map<string, DraftFinding['waived']>();
	for (const finding of previous) {
		if (finding.waived) {
			waivers.set(findingKey(finding), finding.waived);
		}
	}
	const merged = current.map(finding => {
		const waived = finding.waived ?? waivers.get(findingKey(finding));
		return waived ? { ...finding, waived } : finding;
	});
	if (!current.some(finding => finding.severity === 'Advisory')) {
		merged.push(...previous.filter(finding => finding.severity === 'Advisory'));
	}
	const currentKeys = new Set(current.map(findingKey));
	merged.push(...previous.filter(finding => finding.waived && drawingRules.has(finding.rule) && !currentKeys.has(findingKey(finding))));
	return merged;
}

/** The findings that block export: Errors (including Inventor Questions) without a waiver. */
export function blockingFindings(findings: readonly DraftFinding[]): DraftFinding[] {
	return findings.filter(finding => finding.severity === 'Error' && !finding.waived);
}
