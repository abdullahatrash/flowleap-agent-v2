/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import {
	AuthRequiredError,
	DataKeyInvalidError,
	IPatentBackendClient,
} from './patentBackendClient';
import { PatentDataKeysStore } from './patentDataKeysStore';

/**
 * The `FlowLeap: Patent Data Keys` command (#32, ADR 0005): a quick-pick flow to add,
 * test, and clear the user's own EPO OPS and USPTO ODP credentials. Inputs are masked;
 * values go straight to {@link PatentDataKeysStore} (SecretStorage) and are never logged.
 *
 * "Test connection" rides the normal request seam on purpose: the backend's key-forwarding
 * middleware (#30) eagerly validates the EPO pair on ANY guarded request and answers
 * `400 patent_provider_key_invalid` with a `provider` field, so a cheap request doubles as
 * a per-provider probe — no dedicated test endpoint needed.
 */

export const PATENT_DATA_KEYS_COMMAND = 'flowleap.patentDataKeys';

const EPO_SIGNUP_URL = 'https://developers.epo.org/';
const USPTO_SIGNUP_URL = 'https://data.uspto.gov/myodp';

/** A guarded GET that performs no USPTO call — with EPO headers attached, the backend's
 *  eager mint validates the pair, so the response IS the EPO verdict. */
const EPO_PROBE_PATH = '/citation-search/health';
/** A USPTO-backed call so the forwarded ODP key is actually exercised. */
const USPTO_PROBE_PATH = '/citation-search';
const USPTO_PROBE_BODY = { applicationNumber: '16123456' };

type Provider = 'epo' | 'uspto';

export interface TestConnectionResult {
	readonly ok: boolean;
	readonly message: string;
}

/**
 * Probe the backend to verify the CONFIGURED key for `provider`. Pure logic (no UI) so
 * it is unit-testable; the command wraps it in a progress notification.
 */
export async function testPatentDataConnection(client: IPatentBackendClient, provider: Provider): Promise<TestConnectionResult> {
	try {
		if (provider === 'epo') {
			await client.get(EPO_PROBE_PATH, CancellationToken.None, { timeoutMs: 15_000 });
			return { ok: true, message: 'EPO OPS credentials verified.' };
		}
		await client.post(USPTO_PROBE_PATH, USPTO_PROBE_BODY, CancellationToken.None, { timeoutMs: 15_000 });
		return { ok: true, message: 'USPTO ODP key verified.' };
	} catch (error) {
		if (error instanceof DataKeyInvalidError) {
			// The backend names the failing provider — it may differ from the one under test
			// (e.g. testing USPTO while a broken EPO pair is configured fails the eager EPO
			// validation first). Report what actually failed.
			const failed = error.provider === 'epo' ? 'EPO OPS credentials' : 'USPTO ODP key';
			return { ok: false, message: `${failed} rejected by the provider. ${error.provider === provider ? 'Update the key and test again.' : 'Fix or clear that provider first, then re-test.'}` };
		}
		if (error instanceof AuthRequiredError) {
			return { ok: false, message: 'Sign in to FlowLeap first (the test runs through your FlowLeap account).' };
		}
		return { ok: false, message: `Could not reach the FlowLeap backend: ${error instanceof Error ? error.message : String(error)}` };
	}
}

interface ProviderSpec {
	readonly provider: Provider;
	readonly label: string;
	readonly signupUrl: string;
	isConfigured(store: PatentDataKeysStore): boolean;
}

const PROVIDERS: readonly ProviderSpec[] = [
	{ provider: 'epo', label: 'EPO OPS (European Patent Office)', signupUrl: EPO_SIGNUP_URL, isConfigured: s => !!s.getKeys()?.epo },
	{ provider: 'uspto', label: 'USPTO ODP (US Patent Office)', signupUrl: USPTO_SIGNUP_URL, isConfigured: s => !!s.getKeys()?.usptoOdp },
];

/** Register the `FlowLeap: Patent Data Keys` command. */
export function registerPatentDataKeysCommand(store: PatentDataKeysStore, client: IPatentBackendClient, logService: ILogService): vscode.Disposable {
	return vscode.commands.registerCommand(PATENT_DATA_KEYS_COMMAND, async () => {
		try {
			await showProviderMenu(store, client);
		} catch (error) {
			logService.error(`[Patent AI] Patent Data Keys UI failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	});
}

async function showProviderMenu(store: PatentDataKeysStore, client: IPatentBackendClient): Promise<void> {
	const picked = await vscode.window.showQuickPick(
		PROVIDERS.map(spec => ({
			label: spec.label,
			description: spec.isConfigured(store) ? '$(check) Configured' : 'Not configured',
			spec,
		})),
		{ title: 'FlowLeap Patent Data Keys', placeHolder: 'Your keys stay on this machine (secure storage) and are only sent to reach the patent offices.' },
	);
	if (picked) {
		await showActionMenu(store, client, picked.spec);
	}
}

async function showActionMenu(store: PatentDataKeysStore, client: IPatentBackendClient, spec: ProviderSpec): Promise<void> {
	const configured = spec.isConfigured(store);
	const items: vscode.QuickPickItem[] = [
		{ label: configured ? '$(key) Update Key' : '$(key) Add Key', detail: spec.provider === 'epo' ? 'Enter your OPS consumer key and secret (masked)' : 'Enter your ODP API key (masked)' },
		...(configured ? [
			{ label: '$(plug) Test Connection', detail: 'Verify the stored key against the provider' },
			{ label: '$(trash) Clear Key', detail: 'Remove it from secure storage' },
		] : []),
		{ label: '$(link-external) Get a Key', detail: spec.signupUrl },
	];
	const action = await vscode.window.showQuickPick(items, { title: spec.label });
	if (!action) {
		return;
	}
	if (action.label.includes('Get a Key')) {
		await vscode.env.openExternal(vscode.Uri.parse(spec.signupUrl));
		return;
	}
	if (action.label.includes('Clear Key')) {
		await store.clearProvider(spec.provider);
		void vscode.window.showInformationMessage(`${spec.label} key removed.`);
		return;
	}
	if (action.label.includes('Test Connection')) {
		await runConnectionTest(client, spec);
		return;
	}
	await promptAndStoreKey(store, client, spec);
}

async function promptAndStoreKey(store: PatentDataKeysStore, client: IPatentBackendClient, spec: ProviderSpec): Promise<void> {
	if (spec.provider === 'epo') {
		const key = await vscode.window.showInputBox({
			title: 'EPO OPS Consumer Key', password: true, ignoreFocusOut: true,
			prompt: `From your app at ${EPO_SIGNUP_URL} (My Apps → your app → Consumer Key)`,
			validateInput: v => v.trim() ? undefined : 'The consumer key cannot be empty.',
		});
		if (!key) {
			return;
		}
		const secret = await vscode.window.showInputBox({
			title: 'EPO OPS Consumer Secret', password: true, ignoreFocusOut: true,
			prompt: 'The matching Consumer Secret for that app',
			validateInput: v => v.trim() ? undefined : 'The consumer secret cannot be empty.',
		});
		if (!secret) {
			return;
		}
		await store.setEpoCredentials({ key: key.trim(), secret: secret.trim() });
	} else {
		const key = await vscode.window.showInputBox({
			title: 'USPTO ODP API Key', password: true, ignoreFocusOut: true,
			prompt: `From ${USPTO_SIGNUP_URL} (My ODP → API key)`,
			validateInput: v => v.trim() ? undefined : 'The API key cannot be empty.',
		});
		if (!key) {
			return;
		}
		await store.setUsptoOdpKey(key.trim());
	}
	// Offer an immediate verification so a typo is caught now, not mid-research.
	const choice = await vscode.window.showInformationMessage(`${spec.label} key saved to secure storage.`, 'Test Connection');
	if (choice === 'Test Connection') {
		await runConnectionTest(client, spec);
	}
}

async function runConnectionTest(client: IPatentBackendClient, spec: ProviderSpec): Promise<void> {
	const result = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `Testing ${spec.label}…` },
		() => testPatentDataConnection(client, spec.provider),
	);
	if (result.ok) {
		void vscode.window.showInformationMessage(result.message);
	} else {
		void vscode.window.showWarningMessage(result.message);
	}
}
