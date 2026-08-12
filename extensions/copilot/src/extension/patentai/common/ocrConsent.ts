/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The consent gate for Document OCR (issue #213) — the last capability that sends the user's
// own content to FlowLeap-Managed Inference.
//
// PRD 0012 retired query generation and claim analysis by moving them onto the user's own
// Model Path. OCR cannot follow: Mistral OCR is specialised model work no prompt reproduces,
// so under backend ADR 0012 ("FlowLeap runs a model only where the client cannot") it stays a
// managed route — and therefore stays something the user is asked about.
//
// Deliberately NOT built as a registry of subjects. An earlier draft (PR #217, closed) modelled
// three gated capabilities with per-subject verdicts; two of them no longer exist, and ADR 0012
// sets the exception list's target size at zero. A one-member registry is ceremony, and building
// for growth would be backwards for a list meant to shrink.
//
// Scope note: this covers the PDF viewer's "Extract with OCR", which uploads the user's own
// document. It does NOT cover USPTO office-action text extraction, which runs the same Mistral
// OCR over public IFW documents — published prosecution records, not user content.

/** Where the command lives. Hand-mirrored in `pdf-preview`, which cannot import this module. */
export const OCR_CONSENT_COMMAND_ID = 'flowleap.ocr.requestConsent';

/** globalState key. Global rather than workspace-scoped: a privacy posture belongs to the person. */
export const OCR_CONSENT_STORAGE_KEY = 'flowleap.ocrConsent';

/** Who processes the document, named in the prompt — "the cloud" is not a disclosure. */
export const OCR_PROCESSOR = 'Mistral';

/** How long the backend keeps it. */
export const OCR_RETENTION = 'cached for 24 hours';

/**
 * The user's remembered answer. Absent means undecided, which is the default and the state a
 * reset returns to. `once` is deliberately NOT a verdict: it authorises a single extraction
 * and records nothing.
 */
export type ConsentVerdict = 'always' | 'never';

/** What the user picked. `dismissed` covers closing the dialog without choosing. */
export type ConsentAnswer = 'once' | 'always' | 'never' | 'dismissed';

/** What the gate does when it reads the stored verdict. */
export type ConsentGateStep = 'proceed' | 'refuse' | 'ask';

/** What an answered prompt yields: whether this extraction proceeds, and what to remember. */
export interface ConsentAnswerOutcome {
	readonly proceed: boolean;
	readonly persist: ConsentVerdict | undefined;
}

/** Read a stored verdict. Only an undecided user reaches a prompt. */
export function decideFromStored(stored: ConsentVerdict | undefined): ConsentGateStep {
	switch (stored) {
		case 'always': return 'proceed';
		case 'never': return 'refuse';
		default: return 'ask';
	}
}

/**
 * Resolve a prompt answer. Dismissal is "not this time" rather than `never` — a user who closes
 * a dialog has not chosen a policy, and silently recording one would be the opposite of consent.
 */
export function decideFromAnswer(answer: ConsentAnswer): ConsentAnswerOutcome {
	switch (answer) {
		case 'once': return { proceed: true, persist: undefined };
		case 'always': return { proceed: true, persist: 'always' };
		case 'never': return { proceed: false, persist: 'never' };
		default: return { proceed: false, persist: undefined };
	}
}

/** The question, naming what is sent and who processes it. */
export function buildConsentPrompt(): { readonly message: string; readonly detail: string } {
	return {
		message: `Extract with OCR uploads this document to FlowLeap, where ${OCR_PROCESSOR} reads it.`,
		detail: `This is not your own model key — FlowLeap processes the document on its own account, and the result is ${OCR_RETENTION}.`
			+ '\n\nThe "Extract text" button beside it reads the document on this machine and sends nothing.'
			+ '\n\nYou can change this later in FlowLeap Settings under Privacy.',
	};
}

/**
 * What the user is told when they have previously refused. Names their own choice and where to
 * change it — a refusal is a setting, not a failure, and the local path still works.
 */
export function buildRefusalMessage(): string {
	return 'Text extraction with OCR is turned off. You can change this in FlowLeap Settings under Privacy, '
		+ 'or use "Extract text" to read the document on this machine.';
}
