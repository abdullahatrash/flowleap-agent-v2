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

import { DraftFinding } from './finding';

const sections: readonly { heading: string; severity: DraftFinding['severity']; accepts: (finding: DraftFinding) => boolean }[] = [
	{ heading: 'Errors', severity: 'Error', accepts: finding => finding.severity === 'Error' && finding.rule !== 'inventor-question' },
	{ heading: 'Inventor Questions', severity: 'Error', accepts: finding => finding.severity === 'Error' && finding.rule === 'inventor-question' },
	{ heading: 'Notes', severity: 'Note', accepts: finding => finding.severity === 'Note' },
	{ heading: 'Advisory', severity: 'Advisory', accepts: finding => finding.severity === 'Advisory' },
];

const itemPattern = /^- `(?<rule>[^`]+)`(?: \((?<location>[^)]*)\))?: (?<message>.*)$/;
const waiverPattern = /^\s+- Waived:\s*(?<reason>.*?)\s*$/;

function oneLine(text: string): string {
	return text.replace(/\s*\n\s*/g, ' ').trim();
}

function renderItem(finding: DraftFinding): string[] {
	const location = [finding.file, finding.line !== undefined ? `line ${finding.line}` : undefined, finding.claim !== undefined ? `claim ${finding.claim}` : undefined].filter(Boolean).join(', ');
	const item = `- \`${finding.rule}\`${location ? ` (${location})` : ''}: ${oneLine(finding.message)}`;
	return finding.waived ? [item, `  - Waived: ${oneLine(finding.waived.reason)}`] : [item];
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

/** Parses `findings.md`, including the attorney's waivers. */
export function parseFindingsFile(text: string): DraftFinding[] {
	const findings: DraftFinding[] = [];
	let severity: DraftFinding['severity'] | undefined;
	for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
		const heading = /^##\s+(?<title>.+?)\s*$/.exec(line);
		if (heading?.groups) {
			severity = sections.find(section => section.heading.toLowerCase() === heading.groups!.title.toLowerCase())?.severity;
			continue;
		}
		if (!severity) {
			continue;
		}
		const item = itemPattern.exec(line);
		if (item?.groups) {
			findings.push({ severity, rule: item.groups.rule, message: item.groups.message.trim(), ...readLocation(item.groups.location) });
			continue;
		}
		const waiver = waiverPattern.exec(line);
		const last = findings.at(-1);
		if (waiver?.groups?.reason && last && !last.waived) {
			findings[findings.length - 1] = { ...last, waived: { reason: waiver.groups.reason } };
		}
	}
	return findings;
}

function readLocation(location: string | undefined): Pick<DraftFinding, 'file' | 'line' | 'claim'> {
	const result: { file?: string; line?: number; claim?: number } = {};
	for (const part of (location ?? '').split(',').map(entry => entry.trim()).filter(Boolean)) {
		const numbered = /^(?<kind>line|claim) (?<value>\d+)$/.exec(part);
		if (numbered?.groups) {
			result[numbered.groups.kind as 'line' | 'claim'] = Number(numbered.groups.value);
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

/**
 * Merges a new validator run with the previous findings file: a current finding keeps the
 * waiver of the same finding in `previous` (same rule, claim and message; line numbers may
 * move). When `current` has no Advisory items, the Advisory items of `previous` are kept.
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
	return merged;
}

/** The findings that block export: Errors (including Inventor Questions) without a waiver. */
export function blockingFindings(findings: readonly DraftFinding[]): DraftFinding[] {
	return findings.filter(finding => finding.severity === 'Error' && !finding.waived);
}
