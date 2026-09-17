/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Opt-in, content-free activation counters.
//
// FlowLeap ships without usage analytics, which means nobody can answer "is this feature used at
// all?" except by asking users. These four counters answer that and nothing else: an app launch, a
// skill run, a report save, and whether patent-data keys were added. There is no payload for a
// file, a query, a matter, a claim, or model output, and no room in the wire shape for one — the
// props of every event are fixed and closed.
//
// Shaped after `ocrConsent.ts` (the Consent Verdict for Document OCR): the decision logic lives
// here, vscode-free and unit-testable; the service in `vscode-node/` owns globalState, the prompt,
// and the network. The consent copy lives with the prompt rather than here, because `l10n.t()`
// extracts only literal arguments — a builder returning the string would never be translated. Deliberately NOT a general telemetry framework — an event the
// contract does not name cannot be added without changing this file, which is the point.

/** globalState key. Global rather than workspace-scoped: a privacy posture belongs to the person. */
export const ACTIVATION_CONSENT_STORAGE_KEY = 'flowleap.activationCountersConsent';

/**
 * globalState key holding the hashes of the accounts whose first launch has already been handled.
 * Hashes, never account ids: the marker only has to answer "seen before?".
 */
export const ACTIVATION_FIRST_LAUNCH_STORAGE_KEY = 'flowleap.activationFirstLaunchSent';

/** Where the page and the prompt send a user who wants to read the whole story. */
export const ACTIVATION_DATA_HANDLING_URL = 'https://flowleap.co/data-handling';

/** Largest batch the backend accepts, and therefore the cap on the pending queue. */
export const MAX_BATCH = 50;

/**
 * The user's remembered answer. Absent means undecided, which is the default and the state a reset
 * returns to — and while it is absent NOTHING is sent. An unanswered question is not a yes.
 */
export type ActivationConsentVerdict = 'always' | 'never';

/** What the user picked. `dismissed` covers closing the prompt without choosing. */
export type ActivationConsentAnswer = 'always' | 'never' | 'dismissed';

/** What the gate does when it reads the stored verdict. */
export type ActivationConsentGateStep = 'send' | 'drop' | 'ask';

/** What an answered prompt yields: whether counters flow from now on, and what to remember. */
export interface ActivationConsentAnswerOutcome {
	readonly send: boolean;
	readonly persist: ActivationConsentVerdict | undefined;
}

/** The three desktops FlowLeap ships for; the wire contract accepts no other value. */
export type ActivationPlatform = 'darwin' | 'win32' | 'linux';

/** The event names the backend accepts. Adding one is a contract change on both sides. */
export type ActivationEventName = 'app_launched' | 'skill_run_completed' | 'report_saved' | 'keys_added';

/**
 * The name/props pairing, as a closed union so a payload cannot carry a field the contract does not
 * name. `app_launched` has an empty props object rather than none, so every event serialises alike.
 */
export type ActivationEventBody =
	| { readonly name: 'app_launched'; readonly props: Record<string, never> }
	| { readonly name: 'skill_run_completed'; readonly props: { readonly skillId: string } }
	| { readonly name: 'report_saved'; readonly props: { readonly templateKind: string } }
	| { readonly name: 'keys_added'; readonly props: { readonly epo: boolean; readonly uspto: boolean } };

/** What the client stamps on every event. No machine id, no session id, no user id. */
export interface ActivationEventEnvelope {
	/** Client-generated, matching `^[A-Za-z0-9_-]{8,64}$`; lets the backend drop duplicates. */
	readonly id: string;
	/** ISO-8601 timestamp of the moment the event was enqueued. */
	readonly at: string;
	/** The app version the event came from, 1..32 characters. */
	readonly appVersion: string;
	readonly platform: ActivationPlatform;
}

/** One queued, fully stamped event. */
export type ActivationTelemetryEvent = ActivationEventEnvelope & ActivationEventBody;

/** The exact body posted to `/telemetry/activation`. */
export interface ActivationTelemetryRequestBody {
	readonly events: readonly ActivationTelemetryEvent[];
}

/**
 * The ids of the Patent Skills FlowLeap ships, mirroring the directory names under
 * `extensions/copilot/assets/skills/`. Keep in sync when a skill is added or removed: an id that
 * falls out of this set is reported as {@link CUSTOM_SKILL_ID}, which is a loss of signal, never a
 * leak.
 */
export const BUNDLED_SKILL_IDS: ReadonlySet<string> = new Set([
	'audit-report',
	'citation-analysis',
	'claim-analysis',
	'claim-drafting',
	'excess-claims-estimator',
	'fee-reduction-advisor',
	'figure-analysis',
	'freedom-to-operate',
	'infringement-charting',
	'invalidity-analysis',
	'invention-disclosure',
	'investigation-record',
	'legal-research',
	'maintenance-fee-check',
	'office-action-response',
	'patent-examination',
	'patent-landscape',
	'patent-search',
	'patent-translation',
	'pct-vs-ep-routing',
	'portfolio-analysis',
	'pre-filing-checklist',
	'prior-art',
	'sep-declarations',
	'upc-division-router',
	'upc-opt-out-actions',
	'upc-opt-out-check',
	'upc-rop-explainer',
]);

/** What every skill that is not one of FlowLeap's own is reported as. */
export const CUSTOM_SKILL_ID = 'custom';

/** The free-form save: a report written with no template. */
export const FREE_FORM_TEMPLATE_KIND = 'free-form';

/**
 * The id a skill run is reported under.
 *
 * This is the privacy boundary that matters. A user's own skill is named by the user, and patent
 * users name things after the thing they are working on — a client, a matter, an invention, an
 * opponent. `acme-v-widgetco-invalidity` is a sentence about a live dispute, and no counter is
 * worth sending it. So only the names FlowLeap itself ships can ever leave the machine: anything
 * else — a workspace skill, a plugin skill, a personal skill, a typo — collapses to
 * {@link CUSTOM_SKILL_ID}. The cost is that we learn "a custom skill ran" rather than which one,
 * which is the correct trade.
 *
 * Idempotent: applying it to an already-reported id returns that id unchanged.
 */
export function reportedSkillId(skill: string): string {
	const candidate = skill.trim().toLowerCase();
	return BUNDLED_SKILL_IDS.has(candidate) ? candidate : CUSTOM_SKILL_ID;
}

/**
 * Map a platform string (`process.platform`) onto the three the contract accepts. Anything else is
 * reported as `linux` — the other values Node reports are unix desktops, and a value the backend
 * rejects would throw away the whole batch rather than one field.
 */
export function reportedPlatform(platform: string): ActivationPlatform {
	switch (platform) {
		case 'darwin': return 'darwin';
		case 'win32': return 'win32';
		default: return 'linux';
	}
}

/** Which Patent-Data Keys are present. Presence only — a key value never reaches this module. */
export interface PatentDataKeyPresence {
	readonly epo: boolean;
	readonly uspto: boolean;
}

/**
 * The `keys_added` counter for one change of the key store, or `undefined` when there is nothing to
 * count.
 *
 * Only an absent-to-present transition counts, and the booleans name the office that just gained a
 * key — so loading the keys a user already had counts nothing, clearing a key counts nothing, and a
 * clear followed by a re-add counts once for the re-add.
 */
export function keysAddedTransition(previous: PatentDataKeyPresence, next: PatentDataKeyPresence): PatentDataKeyPresence | undefined {
	const epo = next.epo && !previous.epo;
	const uspto = next.uspto && !previous.uspto;
	return epo || uspto ? { epo, uspto } : undefined;
}

/** Read a stored verdict. Only an undecided user reaches a prompt; only `always` sends. */
export function decideFromStored(stored: ActivationConsentVerdict | undefined): ActivationConsentGateStep {
	switch (stored) {
		case 'always': return 'send';
		case 'never': return 'drop';
		default: return 'ask';
	}
}

/**
 * Resolve a prompt answer. Dismissal persists nothing and sends nothing — a user who closed a
 * notification has not chosen a policy, and recording one for them would be the opposite of consent.
 */
export function decideFromAnswer(answer: ActivationConsentAnswer): ActivationConsentAnswerOutcome {
	switch (answer) {
		case 'always': return { send: true, persist: 'always' };
		case 'never': return { send: false, persist: 'never' };
		default: return { send: false, persist: undefined };
	}
}

/**
 * Rebuild one event field by field, per event kind.
 *
 * Written out rather than spread so the compiler checks the whole payload against the contract: a
 * prop that is not named here cannot reach the wire, however it arrived on the object. That is the
 * guarantee the whole feature rests on, so it is enforced by construction, not by a comment.
 */
function wireEvent(event: ActivationTelemetryEvent): ActivationTelemetryEvent {
	const { id, at, appVersion, platform } = event;
	switch (event.name) {
		case 'app_launched':
			return { id, name: 'app_launched', at, appVersion, platform, props: {} };
		case 'skill_run_completed':
			return { id, name: 'skill_run_completed', at, appVersion, platform, props: { skillId: event.props.skillId } };
		case 'report_saved':
			return { id, name: 'report_saved', at, appVersion, platform, props: { templateKind: event.props.templateKind } };
		case 'keys_added':
			return { id, name: 'keys_added', at, appVersion, platform, props: { epo: event.props.epo, uspto: event.props.uspto } };
	}
}

/**
 * The exact request body for a batch. Oversized batches are truncated here rather than rejected by
 * the backend, so a queue that grew past the cap still delivers what it can.
 */
export function buildRequestBody(events: readonly ActivationTelemetryEvent[]): ActivationTelemetryRequestBody {
	return { events: events.slice(0, MAX_BATCH).map(wireEvent) };
}
