/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Suggested follow-up prompts for the panel chat, in the FlowLeap Patent AI voice.
 *
 * The tone mirrors the randomized placeholders in the sessions composer (prior art,
 * freedom-to-operate, claim analysis, landscaping, ...). Each entry is a complete prompt so
 * it can be sent verbatim when clicked; `label` is the short button text.
 */
function getPatentFollowups(): vscode.ChatFollowup[] {
	return [
		{ label: vscode.l10n.t('Search prior art'), prompt: vscode.l10n.t('Search prior art for the invention described above') },
		{ label: vscode.l10n.t('Freedom-to-operate'), prompt: vscode.l10n.t('Run a freedom-to-operate check on this technology') },
		{ label: vscode.l10n.t('Analyze the claims'), prompt: vscode.l10n.t('Analyze the claims of this patent') },
		{ label: vscode.l10n.t('Map the landscape'), prompt: vscode.l10n.t('Map the patent landscape for this technology area') },
		{ label: vscode.l10n.t('Challenge novelty'), prompt: vscode.l10n.t('Find references that could challenge the novelty of this idea') },
		{ label: vscode.l10n.t('Assess patentability'), prompt: vscode.l10n.t('Assess the patentability of this idea') },
		{ label: vscode.l10n.t('Compare patents'), prompt: vscode.l10n.t('Compare the claims of two patents') },
		{ label: vscode.l10n.t('Prosecution history'), prompt: vscode.l10n.t('Summarize the prosecution history of this patent') },
		{ label: vscode.l10n.t('Forward citations'), prompt: vscode.l10n.t('Find who cites this patent') },
		{ label: vscode.l10n.t('Academic literature'), prompt: vscode.l10n.t('Search the academic literature for related work') },
	];
}

/**
 * A follow-up provider that surfaces a small randomized set of patent-research prompts after each
 * response, keeping the panel chat in the FlowLeap Patent AI voice. Attach to the panel participants
 * via {@link vscode.ChatParticipant.followupProvider}.
 */
export class PatentFollowupProvider implements vscode.ChatFollowupProvider {

	private static readonly SUGGESTION_COUNT = 3;

	provideFollowups(_result: vscode.ChatResult, _context: vscode.ChatContext, _token: vscode.CancellationToken): vscode.ChatFollowup[] {
		const followups = getPatentFollowups();
		// Fisher-Yates shuffle so the surfaced suggestions vary between turns.
		for (let i = followups.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[followups[i], followups[j]] = [followups[j], followups[i]];
		}
		return followups.slice(0, PatentFollowupProvider.SUGGESTION_COUNT);
	}
}
