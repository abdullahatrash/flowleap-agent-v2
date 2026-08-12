/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
	buildConsentRefusal,
	decideFromAnswer,
	decideFromStored,
	getManagedInferenceSubject,
	MANAGED_INFERENCE_CONSENT_COMMAND_ID,
	MANAGED_INFERENCE_SUBJECTS,
} from '../../common/managedInferenceConsent';

describe('managed-inference consent registry', () => {

	it('covers exactly the three gated subjects, each naming its processor and retention', () => {
		expect(MANAGED_INFERENCE_SUBJECTS.map(s => ({
			id: s.id,
			displayName: s.displayName,
			processor: s.processor,
			retention: s.retention,
			sends: s.sends,
		}))).toEqual([
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
		]);
	});

	it('resolves a subject by id and rejects an unknown one', () => {
		expect(getManagedInferenceSubject('claim-analysis')?.displayName).toBe('Claim Analysis');
		expect(getManagedInferenceSubject('not-a-subject')).toBeUndefined();
	});

	it('pins the consent command id that pdf-preview repeats by hand', () => {
		// pdf-preview cannot import this module, so it hardcodes the same string before
		// uploading a document for OCR. Changing this value without changing
		// `pdf-preview/src/pdfEditorProvider.ts` silently ungates Document OCR.
		expect(MANAGED_INFERENCE_CONSENT_COMMAND_ID).toBe('flowleap.managedInference.requestConsent');
	});

	it('keeps the document-ocr subject id that crosses the command boundary', () => {
		// Same contract: pdf-preview passes this id as the command argument.
		expect(getManagedInferenceSubject('document-ocr')?.displayName).toBe('Document OCR');
	});
});

describe('managed-inference consent decisions', () => {

	it('maps a stored verdict to the gate step, asking only when undecided', () => {
		expect([
			decideFromStored(undefined),
			decideFromStored('always'),
			decideFromStored('never'),
		]).toEqual(['ask', 'proceed', 'refuse']);
	});

	it('maps a prompt answer to whether to proceed and what to remember', () => {
		expect({
			once: decideFromAnswer('once'),
			always: decideFromAnswer('always'),
			never: decideFromAnswer('never'),
			dismissed: decideFromAnswer('dismissed'),
		}).toEqual({
			// Once authorises this call and stores nothing — it is an answer, not a verdict.
			once: { proceed: true, persist: undefined },
			always: { proceed: true, persist: 'always' },
			never: { proceed: false, persist: 'never' },
			// Dismissing is "not this time": no transmission, and no verdict recorded either.
			dismissed: { proceed: false, persist: undefined },
		});
	});
});

describe('consent refusal text', () => {

	it('names the user\'s own choice, the settings location, and forbids routing around the stop', () => {
		expect(buildConsentRefusal(getManagedInferenceSubject('claim-analysis')!)).toMatchInlineSnapshot(
			`"Claim Analysis is turned off: you chose never to send the claim text you are analysing to FlowLeap-managed inference. The tool did not run and no content was sent. This is a user-action stop, not a dead route: do NOT retry this tool, and do NOT reach the same result another way. Tell the user they can change this in FlowLeap Settings under Privacy, continue with the rest of the task, and name this gap in your answer. Never invent the output this tool would have produced."`
		);
	});
});
