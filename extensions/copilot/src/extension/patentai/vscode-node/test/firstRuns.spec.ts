/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';
import type { ILogService } from '../../../../platform/log/common/logService';
import {
	buildSampleDisclosureUrl,
	FIRST_RUNS_STORAGE_KEY,
	firstRuns,
} from '../../common/firstRuns';
import { parsePromptFile } from '../../common/promptFile';
import { FirstRunsController, FirstRunsSurface } from '../firstRunsController';
import { renderFirstRunsHtml } from '../firstRunsPanel';

const BUNDLED_PROMPTS_DIR = path.resolve(__dirname, '../../../../../assets/prompts/flowleap');

function makeLogService(): ILogService {
	return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogService;
}

/** In-memory globalState double, shared across "launches" the way the real one is. */
function makeContext(initial: Record<string, unknown> = {}) {
	const state = new Map(Object.entries(initial));
	const context = {
		globalState: {
			get: (key: string) => state.get(key),
			update: async (key: string, value: unknown) => {
				if (value === undefined) { state.delete(key); } else { state.set(key, value); }
			},
		},
	} as unknown as IVSCodeExtensionContext;
	return { context, state };
}

/** Records every open and close, so "shown once" is an assertion about calls, not about pixels. */
function makeSurface() {
	const calls: string[] = [];
	const surface: FirstRunsSurface = {
		show: () => { calls.push('show'); },
		close: () => { calls.push('close'); },
	};
	return { surface, calls };
}

/**
 * A launch: a fresh controller over the SAME globalState, because that is what a second launch of
 * the app is. `accountId` of `undefined` means no FlowLeap Session.
 */
function launch(context: IVSCodeExtensionContext, surface: FirstRunsSurface, accountId: string | undefined) {
	return new FirstRunsController(
		context,
		async () => accountId,
		value => `hash:${value}`,
		surface,
		makeLogService(),
	);
}

describe('the published first runs', () => {

	// The exact published set. It appears on the website's /welcome page and in the day-0 trial
	// email; these literals are the app's half of that contract, so an edit to one surface alone
	// fails here rather than reaching a user as three surfaces that disagree.
	const PUBLISHED_PROMPTS = {
		claim: 'Analyse claim 1 of WO1999051190A1. Break it into elements, show me where the description supports each element, and name anything that looks unsupported.',
		priorArt: 'Run a prior-art search on the attached disclosure. Search EPO and USPTO, tag the closest references X, Y or A, and quote the passage that earned each tag.',
		officeAction: 'Read the attached office action. List every rejection, the reference cited for it, and exactly what the examiner says is missing.',
	} as const;

	it('carries the three prompts verbatim, in the published order, each with its result line', () => {
		expect(firstRuns().map(run => ({ id: run.id, name: run.name, prompt: run.prompt, result: run.result }))).toEqual([
			{
				id: 'claim',
				name: 'Read a claim properly',
				prompt: PUBLISHED_PROMPTS.claim,
				result: 'You get an element-by-element map of the claim, the supporting passage beside each element, and the gaps named.',
			},
			{
				id: 'priorArt',
				name: 'Search for prior art',
				prompt: PUBLISHED_PROMPTS.priorArt,
				result: 'You get a ranked list of the closest references from both offices, each tagged and quoted, saved as a report you can open.',
			},
			{
				id: 'officeAction',
				name: 'Read an office action',
				prompt: PUBLISHED_PROMPTS.officeAction,
				result: 'You get every rejection set out with its cited reference and the examiner’s own words, so you can start drafting the response.',
			},
		]);
	});

	it('ships each one as a bundled prompt file whose body is the same prompt', () => {
		expect(firstRuns().map(run => {
			const file = path.join(BUNDLED_PROMPTS_DIR, `${run.promptFileName}.prompt.md`);
			return { id: run.id, body: parsePromptFile(fs.readFileSync(file, 'utf8'), run.promptFileName).body };
		})).toEqual([
			{ id: 'claim', body: PUBLISHED_PROMPTS.claim },
			{ id: 'priorArt', body: PUBLISHED_PROMPTS.priorArt },
			{ id: 'officeAction', body: PUBLISHED_PROMPTS.officeAction },
		]);
	});

	it('renders all three on the page, with the prompts unaltered and a dismiss that sticks', () => {
		const html = renderFirstRunsHtml('test-nonce', firstRuns(), 'https://flowleap.co/sample.pdf');

		expect({
			prompts: Object.values(PUBLISHED_PROMPTS).filter(prompt => html.includes(prompt)).length,
			runButtons: (html.match(/data-action="run"/g) ?? []).length,
			sampleLinks: (html.match(/data-action="openSample"/g) ?? []).length,
			dismiss: html.includes('data-action="dismiss"'),
		}).toEqual({ prompts: 3, runButtons: 3, sampleLinks: 1, dismiss: true });
	});

	it('offers the public sample disclosure from the configured website origin', () => {
		expect([
			buildSampleDisclosureUrl('https://flowleap.co'),
			buildSampleDisclosureUrl('http://localhost:3000/'),
		]).toEqual([
			'https://flowleap.co/sample-matter/dental-composites-public-demo-disclosure.pdf',
			'http://localhost:3000/sample-matter/dental-composites-public-demo-disclosure.pdf',
		]);
	});
});

describe('FirstRunsController', () => {

	it('shows the first runs once for an account and never on a later launch', async () => {
		const { context, state } = makeContext();
		const { surface, calls } = makeSurface();

		await launch(context, surface, 'user_abc').maybeShowOnLaunch();
		await launch(context, surface, 'user_abc').maybeShowOnLaunch();
		await launch(context, surface, 'user_abc').maybeShowOnLaunch();

		expect({ calls, seen: state.get(FIRST_RUNS_STORAGE_KEY) }).toEqual({
			calls: ['show'],
			seen: ['hash:user_abc'],
		});
	});

	it('keys the marker to the account, so a second account on the same machine still gets them', async () => {
		const { context, state } = makeContext();
		const { surface, calls } = makeSurface();

		await launch(context, surface, 'user_abc').maybeShowOnLaunch();
		await launch(context, surface, 'user_xyz').maybeShowOnLaunch();

		expect({ calls, seen: state.get(FIRST_RUNS_STORAGE_KEY) }).toEqual({
			calls: ['show', 'show'],
			seen: ['hash:user_abc', 'hash:user_xyz'],
		});
	});

	it('waits for a FlowLeap Session and records nothing without one', async () => {
		const { context, state } = makeContext();
		const { surface, calls } = makeSurface();

		await launch(context, surface, undefined).maybeShowOnLaunch();

		expect({ calls, seen: state.get(FIRST_RUNS_STORAGE_KEY) }).toEqual({ calls: [], seen: undefined });
	});

	it('makes a dismiss stick: it closes the surface and no later launch reopens it', async () => {
		// The surface was reopened with the command, so nothing is recorded yet — this is the state
		// in which the dismiss has to do the remembering itself.
		const { context, state } = makeContext();
		const { surface, calls } = makeSurface();
		const controller = launch(context, surface, 'user_abc');

		controller.showOnDemand();
		await controller.dismiss();
		await launch(context, surface, 'user_abc').maybeShowOnLaunch();

		expect({ calls, seen: state.get(FIRST_RUNS_STORAGE_KEY) }).toEqual({
			calls: ['show', 'close'],
			seen: ['hash:user_abc'],
		});
	});

	it('records a dismiss only once when the launch gate already recorded it', async () => {
		const { context, state } = makeContext();
		const { surface, calls } = makeSurface();
		const controller = launch(context, surface, 'user_abc');

		await controller.maybeShowOnLaunch();
		await controller.dismiss();

		expect({ calls, seen: state.get(FIRST_RUNS_STORAGE_KEY) }).toEqual({
			calls: ['show', 'close'],
			seen: ['hash:user_abc'],
		});
	});
});
