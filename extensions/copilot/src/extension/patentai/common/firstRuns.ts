/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

// The three first runs a new FlowLeap user is offered, in order: read a claim, search for prior
// art, read an office action.
//
// They are data, not markup, because the same three have to appear in three places that must never
// disagree — the website's `/welcome` page (`src/features/onboarding/first-runs.ts`), the day-0
// trial email, and this app. Changing one here is a deliberate change to the published set, and the
// other two surfaces are updated in the same change. `firstRuns.spec.ts` pins every prompt string
// and pins the bundled `.prompt.md` seeds against it, so an edit that reaches only one surface
// fails the build rather than the user.
//
// The gate below is shaped after `ocrConsent.ts`: the decision is pure and lives here, while the
// panel, globalState and the account lookup live in `vscode-node/`.

/**
 * globalState key holding the hashes of the accounts that have already been shown the first runs.
 * Hashes, never account ids: the marker only has to answer "seen before?", and it mirrors the
 * convention of the activation-telemetry first-launch hook (#349) so the two stores read alike.
 */
export const FIRST_RUNS_STORAGE_KEY = 'flowleap.firstRunsShown';

/** Path on the website that serves the public sample disclosure offered with the prior-art run. */
export const SAMPLE_DISCLOSURE_PATH = '/sample-matter/dental-composites-public-demo-disclosure.pdf';

/** Identifies one first run. Matches the website's ids so the three surfaces can be diffed. */
export type FirstRunId = 'claim' | 'priorArt' | 'officeAction';

/** What the run needs attached before it can answer, or `undefined` when it needs nothing. */
export type FirstRunAttachment = 'sample' | 'own';

/** One first run: its name, the prompt verbatim, and one line of what comes back. */
export interface FirstRun {
	readonly id: FirstRunId;
	readonly name: string;
	/** The published prompt, byte-for-byte. This is what the click puts in the chat input. */
	readonly prompt: string;
	/** One line of what comes back, worded exactly as the website and the trial email word it. */
	readonly result: string;
	/** One-line identification of a document the prompt names, so a bare number is not unexplained. */
	readonly note?: string;
	readonly attachment?: FirstRunAttachment;
	/** File stem of the bundled `.prompt.md` under `assets/prompts/flowleap/` carrying the same prompt. */
	readonly promptFileName: string;
}

/**
 * The published three, localized at call time.
 *
 * A function rather than a module constant because `l10n.t()` must run after the extension's
 * language bundle is loaded; the literal arguments keep every string extractable.
 */
export function firstRuns(): readonly FirstRun[] {
	return [
		{
			id: 'claim',
			name: l10n.t('Read a claim properly'),
			prompt: l10n.t('Analyse claim 1 of WO1999051190A1. Break it into elements, show me where the description supports each element, and name anything that looks unsupported.'),
			result: l10n.t('You get an element-by-element map of the claim, the supporting passage beside each element, and the gaps named.'),
			// A bare publication number tells the reader nothing, so say what it is. Chosen because it
			// sits in the same dental-composites field as the sample disclosure, so the first two runs
			// tell one story.
			note: l10n.t('WO1999051190A1 is Sun Medical’s 1999 published application on organic composite filler for dental use.'),
			promptFileName: 'read-a-claim',
		},
		{
			id: 'priorArt',
			name: l10n.t('Search for prior art'),
			prompt: l10n.t('Run a prior-art search on the attached disclosure. Search EPO and USPTO, tag the closest references X, Y or A, and quote the passage that earned each tag.'),
			result: l10n.t('You get a ranked list of the closest references from both offices, each tagged and quoted, saved as a report you can open.'),
			note: l10n.t('Attach a disclosure first. Your own unfiled work does not have to be the first thing you put into a new tool — the public sample disclosure below is a four-page demo brief with nothing confidential in it.'),
			attachment: 'sample',
			promptFileName: 'search-for-prior-art',
		},
		{
			id: 'officeAction',
			name: l10n.t('Read an office action'),
			prompt: l10n.t('Read the attached office action. List every rejection, the reference cited for it, and exactly what the examiner says is missing.'),
			result: l10n.t('You get every rejection set out with its cited reference and the examiner’s own words, so you can start drafting the response.'),
			note: l10n.t('Attach your own office action first — this run reads the document you give it, so there is no sample for this one.'),
			attachment: 'own',
			promptFileName: 'read-an-office-action',
		},
	];
}

/** Build the public sample-disclosure URL from the configured website origin. */
export function buildSampleDisclosureUrl(frontendUrl: string): string {
	return `${frontendUrl.replace(/\/+$/, '')}${SAMPLE_DISCLOSURE_PATH}`;
}

/** What the gate does when it reads the stored markers. */
export type FirstRunsGateStep = 'show' | 'skip';

/**
 * Whether this account has seen the first runs yet.
 *
 * @param seen Markers already stored, or `undefined` on a fresh profile.
 * @param marker Hash of the account id to test.
 */
export function firstRunsGateStep(seen: readonly string[] | undefined, marker: string): FirstRunsGateStep {
	return seen?.includes(marker) ? 'skip' : 'show';
}

/**
 * The marker list to store once an account has been handled. Idempotent, so recording a dismiss
 * after the panel already recorded its own opening leaves the list unchanged.
 *
 * @param seen Markers already stored, or `undefined` on a fresh profile.
 * @param marker Hash of the account id to record.
 */
export function rememberFirstRuns(seen: readonly string[] | undefined, marker: string): string[] {
	const existing = seen ?? [];
	return existing.includes(marker) ? [...existing] : [...existing, marker];
}
