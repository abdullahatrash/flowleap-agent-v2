/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The rule id of an open Inventor Question Finding, and the kind of an Inventor Question
 * paragraph of the draft.
 */
export const INVENTOR_QUESTION = 'inventor-question';

/**
 * A Finding of the Application Drafting validators or of the advisory review (ADR 0012).
 * An Error blocks export until it is waived with a reason; a Note never blocks; an Advisory
 * item comes from the model review and never says "passed".
 */
export interface DraftFinding {
	readonly severity: 'Error' | 'Note' | 'Advisory';
	/** The validator rule id, e.g. `antecedent-basis`, or `advisory` for model review items. */
	readonly rule: string;
	readonly message: string;
	/** The drafting file the line refers to, e.g. `claims.md`. */
	readonly file?: string;
	/** The 1-based line in `file`. */
	readonly line?: number;
	readonly claim?: number;
	/** The Inventor Question the finding is about, e.g. `IQ-3`. */
	readonly question?: string;
	/** The attorney's waiver, kept in the findings file. */
	readonly waived?: { readonly reason: string };
	/** True for a Note that records that its check did not run; the Drawing Set receipt shows the row as `not-checked`. */
	readonly notChecked?: boolean;
	/** The rule text a drawings check applies, e.g. `37 CFR 1.84(q)`; the drafting validators set none. */
	readonly citation?: string;
}

/** The findings with the Errors first, each group in its given order. */
export function errorsFirst(findings: readonly DraftFinding[]): DraftFinding[] {
	return [...findings.filter(finding => finding.severity === 'Error'), ...findings.filter(finding => finding.severity !== 'Error')];
}

/** True for an Inventor Question Finding (an Error that blocks export like the other Errors). */
export function isInventorQuestion(finding: DraftFinding): boolean {
	return finding.rule === INVENTOR_QUESTION;
}

/** What {@link findingLine} adds to a line; the drawings engine lines carry both. */
export interface FindingLineOptions {
	/** Puts the severity before the rule: `- Error \`rule\``. */
	readonly severity?: boolean;
	/** Ends the line with the rule citation in brackets, when the finding has one. */
	readonly citation?: boolean;
}

/** One line per finding, for a tool result: `- \`rule\` (file, line N, claim N): message`. */
export function findingLine(finding: DraftFinding): string {
	return formatFindingLine(finding, {});
}

/** {@link findingLine} with what the options add. */
export function formatFindingLine(finding: DraftFinding, options: FindingLineOptions): string {
	const location = [finding.file, finding.line !== undefined ? `line ${finding.line}` : undefined, finding.claim !== undefined ? `claim ${finding.claim}` : undefined].filter(Boolean).join(', ');
	const citation = options.citation && finding.citation ? ` [${finding.citation}]` : '';
	return `- ${options.severity ? `${finding.severity} ` : ''}\`${finding.rule}\`${location ? ` (${location})` : ''}: ${finding.message.replace(/\s*\n\s*/g, ' ')}${citation}`;
}
