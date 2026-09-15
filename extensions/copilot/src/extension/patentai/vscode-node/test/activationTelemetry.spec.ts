/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
	ActivationTelemetryEvent,
	buildRequestBody,
	BUNDLED_SKILL_IDS,
	CUSTOM_SKILL_ID,
	decideFromAnswer,
	decideFromStored,
	keysAddedTransition,
	MAX_BATCH,
	reportedPlatform,
	reportedSkillId,
} from '../../common/activationTelemetry';

function event(overrides: Partial<ActivationTelemetryEvent> = {}): ActivationTelemetryEvent {
	return {
		id: 'abcdefgh1234',
		name: 'app_launched',
		at: '2026-09-14T10:00:00.000Z',
		appVersion: '1.2.3',
		platform: 'darwin',
		props: {},
		...overrides,
	} as ActivationTelemetryEvent;
}

describe('activationTelemetry', () => {

	it('reports FlowLeap\'s own skills by id and everything else as custom', () => {
		expect([
			reportedSkillId('prior-art'),
			reportedSkillId('Freedom-To-Operate'),
			reportedSkillId('  patent-landscape  '),
			reportedSkillId('acme-v-widgetco-invalidity'),
			reportedSkillId(''),
			reportedSkillId(CUSTOM_SKILL_ID),
		]).toEqual(['prior-art', 'freedom-to-operate', 'patent-landscape', 'custom', 'custom', 'custom']);
	});

	it('lists exactly the skills FlowLeap ships, in a shape the wire contract accepts', () => {
		// Read off disk rather than counted: a skill that ships while this set stays behind reports
		// as `custom`, and the funnel silently undercounts the very thing it exists to measure.
		const skillsDir = join(__dirname, '../../../../../assets/skills');
		const onDisk = readdirSync(skillsDir, { withFileTypes: true })
			.filter(entry => entry.isDirectory())
			.map(entry => entry.name);

		expect({
			missingFromTheSet: onDisk.filter(id => !BUNDLED_SKILL_IDS.has(id)).sort(),
			extraInTheSet: [...BUNDLED_SKILL_IDS].filter(id => !onDisk.includes(id)).sort(),
			malformedIds: [...BUNDLED_SKILL_IDS].filter(id => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)).sort(),
		}).toEqual({ missingFromTheSet: [], extraInTheSet: [], malformedIds: [] });
	});

	it('maps platforms onto the three the contract accepts', () => {
		expect([
			reportedPlatform('darwin'),
			reportedPlatform('win32'),
			reportedPlatform('linux'),
			reportedPlatform('freebsd'),
		]).toEqual(['darwin', 'win32', 'linux', 'linux']);
	});

	it('sends only on a stored always, and persists only what the user chose', () => {
		expect({
			stored: [decideFromStored(undefined), decideFromStored('always'), decideFromStored('never')],
			answers: [decideFromAnswer('always'), decideFromAnswer('never'), decideFromAnswer('dismissed')],
		}).toEqual({
			stored: ['ask', 'send', 'drop'],
			answers: [
				{ send: true, persist: 'always' },
				{ send: false, persist: 'never' },
				{ send: false, persist: undefined },
			],
		});
	});

	it('rebuilds each event from the contract\'s fields, dropping anything else hung off it', () => {
		const smuggled = { ...event({ name: 'report_saved', props: { templateKind: 'fto-memo' } }), filePath: '/matters/acme/report.md' };

		expect(buildRequestBody([smuggled as ActivationTelemetryEvent])).toEqual({
			events: [{
				id: 'abcdefgh1234',
				name: 'report_saved',
				at: '2026-09-14T10:00:00.000Z',
				appVersion: '1.2.3',
				platform: 'darwin',
				props: { templateKind: 'fto-memo' },
			}],
		});
	});

	it('counts a keys_added only on an absent-to-present transition', () => {
		const none = { epo: false, uspto: false };
		const both = { epo: true, uspto: true };

		expect({
			initialLoadOfExistingKeys: keysAddedTransition(both, both),
			nothingYet: keysAddedTransition(none, none),
			epoAdded: keysAddedTransition(none, { epo: true, uspto: false }),
			usptoAddedBesideAnExistingEpo: keysAddedTransition({ epo: true, uspto: false }, both),
			cleared: keysAddedTransition(both, none),
			reAddedAfterAClear: keysAddedTransition(none, both),
		}).toEqual({
			initialLoadOfExistingKeys: undefined,
			nothingYet: undefined,
			epoAdded: { epo: true, uspto: false },
			usptoAddedBesideAnExistingEpo: { epo: false, uspto: true },
			cleared: undefined,
			reAddedAfterAClear: { epo: true, uspto: true },
		});
	});

	it('truncates an oversized batch to the cap', () => {
		const events = Array.from({ length: MAX_BATCH + 10 }, (_, i) => event({ id: `event-${i}0000` }));

		expect(buildRequestBody(events).events.length).toBe(MAX_BATCH);
	});
});
