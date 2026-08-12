/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The registry and the pure decision logic behind the FlowLeap-Managed Inference consent gate
// (issue #213). FlowLeap-Managed Inference is the small set of backend routes that run an LLM or
// OCR model on FlowLeap's OWN provider accounts — distinct from the Model Path (BYOK, the user's
// own key, client-side) and from plain patent-data retrieval, which involves no model at all.
//
// Everything here is platform-neutral and side-effect free so the guarantee can be unit-tested
// without VS Code. The store, the prompt and the command seam live in
// `../vscode-node/managedInferenceConsentService`.

/**
 * The command the `pdf-preview` extension calls before it uploads a document for OCR.
 *
 * This is the one hand-mirrored fact in the gate. `pdf-preview` cannot import from this
 * extension, so it repeats this string literally — exactly as it already hand-mirrors the
 * backend URL resolution. Renaming it here silently ungates OCR, so the value is asserted in
 * `managedInferenceConsent.spec.ts` and repeated in a comment at the call site.
 */
export const MANAGED_INFERENCE_CONSENT_COMMAND_ID = 'flowleap.managedInference.requestConsent';

/** The gated capabilities. A subject is a capability, not a tool — Query Generation covers two. */
export type ManagedInferenceSubjectId = 'query-generation' | 'claim-analysis' | 'document-ocr';

/**
 * One gated capability, carrying everything the prompt and the Privacy settings section must
 * disclose: what leaves the machine, who processes it, and how long it is kept.
 */
export interface ManagedInferenceSubject {
	readonly id: ManagedInferenceSubjectId;
	/** Title-style name, used as the prompt title and the settings row label. */
	readonly displayName: string;
	/** The company that runs the model. Named verbatim in the prompt — "the cloud" is not a disclosure. */
	readonly processor: string;
	/** How long the backend keeps the content, phrased to drop into a sentence. */
	readonly retention: string;
	/** What is transmitted, phrased from the user's point of view. */
	readonly sends: string;
}

/**
 * The three subjects, verified against `flowleap-backend`. Query Generation deliberately covers
 * both `/build-patent-query` and `/build-uspto-query`: they send the same Invention Disclosure
 * description down the same managed path, and the CLI gates both behind its single
 * `--allow-external-processing` flag.
 */
export const MANAGED_INFERENCE_SUBJECTS: readonly ManagedInferenceSubject[] = [
	{
		id: 'query-generation',
		displayName: 'Query Generation',
		processor: 'Anthropic (OpenAI as fallback)',
		retention: 'cached for 2 hours',
		sends: 'the invention description you are searching on',
	},
	{
		id: 'claim-analysis',
		displayName: 'Claim Analysis',
		processor: 'Anthropic (OpenAI as fallback)',
		retention: 'cached for 2 hours',
		sends: 'the claim text you are analysing',
	},
	{
		id: 'document-ocr',
		displayName: 'Document OCR',
		processor: 'Mistral',
		retention: 'cached for 24 hours',
		sends: 'the whole document you are extracting',
	},
];

/** The subject with this id, or undefined — the id crosses a command boundary, so it is untrusted. */
export function getManagedInferenceSubject(id: string): ManagedInferenceSubject | undefined {
	return MANAGED_INFERENCE_SUBJECTS.find(subject => subject.id === id);
}

/**
 * Total lookup for callers that already hold a typed id (the gated tools name their subject as a
 * literal). Avoids a non-null assertion at every call site; {@link getManagedInferenceSubject} is
 * the partial version for ids arriving as untyped strings.
 */
export const MANAGED_INFERENCE_SUBJECTS_BY_ID: Readonly<Record<ManagedInferenceSubjectId, ManagedInferenceSubject>> =
	Object.fromEntries(MANAGED_INFERENCE_SUBJECTS.map(subject => [subject.id, subject])) as Record<ManagedInferenceSubjectId, ManagedInferenceSubject>;

/**
 * The user's remembered answer for a subject. Absent means undecided, which is the default and
 * the state a reset returns to. `once` is deliberately NOT a verdict: it authorises a single call
 * and records nothing.
 */
export type ConsentVerdict = 'always' | 'never';

/** What the user picked in the prompt. `dismissed` covers closing it without choosing. */
export type ConsentAnswer = 'once' | 'always' | 'never' | 'dismissed';

/** What the gate does when it reads the stored verdict. */
export type ConsentGateStep = 'proceed' | 'refuse' | 'ask';

/** What an answered prompt yields: whether this call proceeds, and what to remember. */
export interface ConsentAnswerOutcome {
	readonly proceed: boolean;
	readonly persist: ConsentVerdict | undefined;
}

/** Read a stored verdict. Only an undecided subject reaches the user with a prompt. */
export function decideFromStored(stored: ConsentVerdict | undefined): ConsentGateStep {
	switch (stored) {
		case 'always': return 'proceed';
		case 'never': return 'refuse';
		default: return 'ask';
	}
}

/**
 * Resolve a prompt answer. Dismissal is treated as "not this time" rather than as `never` — a
 * user who closes a dialog has not chosen a policy, and silently recording one would be the
 * opposite of consent.
 */
export function decideFromAnswer(answer: ConsentAnswer): ConsentAnswerOutcome {
	switch (answer) {
		case 'once': return { proceed: true, persist: undefined };
		case 'always': return { proceed: true, persist: 'always' };
		case 'never': return { proceed: false, persist: 'never' };
		default: return { proceed: false, persist: undefined };
	}
}

/**
 * What a gated tool returns to the model when the user has refused. Not localized: this text is
 * read by the model, not shown to the user.
 *
 * The wording mirrors the key-gate doctrine deliberately — a consent refusal is the same class of
 * event as a missing Patent-Data Key. It is a user-action stop, not an exhausted route, so the
 * agent must not retry it, must not reach the same result by another path, and must not invent
 * the output. Saying so in the tool result matters as much as saying it in the system prompt:
 * this text is the reminder present at the moment the agent is deciding what to do next.
 */
export function buildConsentRefusal(subject: ManagedInferenceSubject): string {
	return `${subject.displayName} is turned off: you chose never to send ${subject.sends} to FlowLeap-managed inference. `
		+ 'The tool did not run and no content was sent. '
		+ 'This is a user-action stop, not a dead route: do NOT retry this tool, and do NOT reach the same result another way. '
		+ 'Tell the user they can change this in FlowLeap Settings under Privacy, continue with the rest of the task, and name this gap in your answer. '
		+ 'Never invent the output this tool would have produced.';
}

/**
 * The provenance line appended to a gated tool's successful result, so the disclosure stays
 * visible after the one-time prompt is behind the user.
 */
export function buildProcessingNotice(subject: ManagedInferenceSubject): string {
	return `_Processed by ${subject.processor} via FlowLeap-managed inference (${subject.retention})._`;
}
