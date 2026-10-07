/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
	/** The attorney's waiver, kept in the findings file. */
	readonly waived?: { readonly reason: string };
}
