/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFlowLeapCliService } from '../../../../../platform/flowleapCli/common/flowleapCliService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationHandle, INotificationProgress, INotificationService, IPromptChoice, IPromptOptions, Severity } from '../../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { FlowLeapCliNudge } from '../../browser/flowleapCliNudge.js';

const noopProgress: INotificationProgress = { infinite() { }, total() { }, worked() { }, done() { } };

const noopNotificationHandle: INotificationHandle = {
	onDidClose: Event.None,
	onDidChangeVisibility: Event.None,
	progress: noopProgress,
	updateSeverity() { },
	updateMessage() { },
	updateActions() { },
	close() { },
};

interface IRecordedPrompt {
	readonly severity: Severity;
	readonly choiceLabels: string[];
	readonly hasNeverShowAgain: boolean;
}

function createNudge(cliResult: string | undefined | Error, prompts: IRecordedPrompt[]): FlowLeapCliNudge {
	const cliService: Pick<IFlowLeapCliService, 'findFlowLeapCli'> = {
		findFlowLeapCli: async () => {
			if (cliResult instanceof Error) {
				throw cliResult;
			}
			return cliResult;
		}
	};

	const notificationService: Pick<INotificationService, 'prompt'> = {
		prompt: (severity: Severity, _message: string, choices: IPromptChoice[], options?: IPromptOptions): INotificationHandle => {
			prompts.push({
				severity,
				choiceLabels: choices.map(choice => choice.label),
				hasNeverShowAgain: !!options?.neverShowAgain,
			});
			return noopNotificationHandle;
		}
	};

	const openerService: Pick<IOpenerService, 'open'> = {
		open: async () => true
	};

	return new FlowLeapCliNudge(
		cliService as IFlowLeapCliService,
		notificationService as INotificationService,
		openerService as IOpenerService,
		new NullLogService(),
	);
}

suite('FlowLeapCliNudge', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('shows the install nudge only when the CLI is missing and only once', async () => {
		const missingPrompts: IRecordedPrompt[] = [];
		const missing = createNudge(undefined, missingPrompts);
		await missing.checkOnce();
		await missing.checkOnce(); // idempotent — must not re-prompt
		missing.dispose();

		const presentPrompts: IRecordedPrompt[] = [];
		const present = createNudge('/usr/local/bin/flowleap', presentPrompts);
		await present.checkOnce();
		present.dispose();

		const failedPrompts: IRecordedPrompt[] = [];
		const failed = createNudge(new Error('boom'), failedPrompts);
		await failed.checkOnce();
		failed.dispose();

		assert.deepStrictEqual(
			{ missing: missingPrompts, present: presentPrompts, failed: failedPrompts },
			{
				missing: [{ severity: Severity.Info, choiceLabels: ['Install Instructions'], hasNeverShowAgain: true }],
				present: [],
				failed: [],
			},
		);
	});
});
