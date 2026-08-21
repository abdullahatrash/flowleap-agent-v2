/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { getPatentAIConfig } from './configService';
import { FlowLeapAuthenticationProvider } from './flowleapAuthProvider';
import { NON_BYOK_VENDORS } from './patentEndpointProvider';

/**
 * Command bridge from the workbench-core onboarding wizard (issue #79) to this extension's FlowLeap
 * state. The wizard lives in core and must not import across the extension boundary, so — mirroring
 * the `flowleap.signIn` seam — it talks to these three commands instead:
 *
 * - `flowleap.checkSubscription` → the tri-state access the Trial step polls until active/trialing.
 * - `flowleap.checkModelConfigured` → whether a BYO model exists, so the Model step reflects done-state.
 * - `flowleap.startTrial` → opens the trial checkout in the browser (the proactive twin of the
 *   reactive `402` "Start free trial" path).
 */

/** Build the proactive trial-checkout URL from the frontend origin. */
export function buildTrialCheckoutUrl(frontendUrl: string): string {
	return `${frontendUrl.replace(/\/+$/, '')}/pricing`;
}

/**
 * Whether any of the given model vendors is a real BYO model rather than an agent pseudo-vendor —
 * the same test the Setup tree's model row uses ({@link NON_BYOK_VENDORS}).
 *
 * The `flowleap-trial` vendor (ADR 0015, #243) counts as configured by design: while `trialing`
 * the FlowLeap Trial provider serves working models, so setup must not ask for a key the trial
 * already covers. The provider itself hides those models for every non-trialing state, so a
 * non-trialing user without a BYO key still resolves to "not configured" here.
 */
export function hasByokModel(vendors: readonly string[]): boolean {
	return vendors.some(vendor => !NON_BYOK_VENDORS.has(vendor));
}

export function registerOnboardingBridgeCommands(
	authProvider: FlowLeapAuthenticationProvider,
	logService: ILogService,
): vscode.Disposable {
	const disposables: vscode.Disposable[] = [];

	// Tri-state subscription access for the wizard's Trial-step poll (`active` | `inactive` | `unknown`).
	disposables.push(vscode.commands.registerCommand('flowleap.checkSubscription', () => authProvider.getSubscriptionAccess()));

	// Whether a BYO model is connected — detected the same way the Setup tree does.
	disposables.push(vscode.commands.registerCommand('flowleap.checkModelConfigured', async (): Promise<boolean> => {
		try {
			const models = await vscode.lm.selectChatModels({});
			return hasByokModel(models.map(m => m.vendor));
		} catch {
			// Model enumeration unavailable (e.g. during startup) — treat as not configured.
			return false;
		}
	}));

	// Open the trial checkout proactively in the browser.
	disposables.push(vscode.commands.registerCommand('flowleap.startTrial', async (): Promise<void> => {
		const url = buildTrialCheckoutUrl(getPatentAIConfig().frontendUrl);
		await vscode.env.openExternal(vscode.Uri.parse(url));
	}));

	logService.info('[Patent AI] Onboarding bridge commands registered');
	return vscode.Disposable.from(...disposables);
}
