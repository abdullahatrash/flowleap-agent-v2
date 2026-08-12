/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import {
	buildConsentRefusal,
	buildProcessingNotice,
	ManagedInferenceSubjectId,
	MANAGED_INFERENCE_SUBJECTS_BY_ID,
} from '../../patentai/common/managedInferenceConsent';
import { IManagedInferenceConsentService } from '../../patentai/vscode-node/managedInferenceConsentService';

/**
 * The two lines every tool that reaches FlowLeap-Managed Inference needs (#213), kept here so the
 * three gated tools stay identical and a fourth cannot drift.
 */

/**
 * Ask the consent gate before transmitting anything.
 *
 * Returns `undefined` when the call may proceed, or the tool result to return verbatim when the
 * user has refused. Deliberately a result rather than a throw: a thrown error reads to the agent
 * as a failure worth retrying, while the refusal text tells it this is a user-action stop.
 *
 * Call this as the FIRST statement of `invoke` — before input validation, before any logging that
 * echoes content, and always before the backend call.
 */
export async function refuseWithoutManagedInferenceConsent(
	consentService: IManagedInferenceConsentService,
	subjectId: ManagedInferenceSubjectId,
): Promise<LanguageModelToolResult | undefined> {
	if (await consentService.requestConsent(subjectId)) {
		return undefined;
	}
	return new LanguageModelToolResult([
		new LanguageModelTextPart(buildConsentRefusal(MANAGED_INFERENCE_SUBJECTS_BY_ID[subjectId]))
	]);
}

/** Append the provenance line so the disclosure outlives the one-time prompt. */
export function withProcessingNotice(text: string, subjectId: ManagedInferenceSubjectId): string {
	return `${text}\n\n${buildProcessingNotice(MANAGED_INFERENCE_SUBJECTS_BY_ID[subjectId])}`;
}
