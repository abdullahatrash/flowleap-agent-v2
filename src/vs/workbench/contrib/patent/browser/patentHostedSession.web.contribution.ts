/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IBrowserWorkbenchEnvironmentService } from '../../../services/environment/browser/environmentService.js';

/**
 * Hosted Workspace single sign-in (FlowLeap #548).
 *
 * The nginx gate in front of a Hosted Workspace keeps the user's FlowLeap token in the HttpOnly
 * `fl_hosted` cookie. The Patent Agent extension runs in the extension host on the server, so it
 * cannot see that cookie. This command runs in the web client: it reads the token once from the
 * gate's same-origin `/_flowleap/session` endpoint and returns it to the caller (the extension),
 * which keeps it in its secret storage (on the server, #547). The token is never written to
 * browser storage here.
 *
 * Returns `undefined` when the workbench is not a Hosted Workspace (no `hostedUserData`), when
 * the endpoint is absent or refuses, or when the answer is not a well-formed token.
 */
export const HOSTED_GATE_SESSION_COMMAND_ID = '_flowleap.hostedGateSession';

/** The gate endpoint (scripts/hosted/install.sh). Same origin as the workbench. */
export const HOSTED_GATE_SESSION_PATH = '/_flowleap/session';

/** The header the gate requires, so that a plain cross-site request cannot get the token. */
export const HOSTED_GATE_SESSION_HEADER = 'X-FlowLeap-Hosted';

/** The same token alphabet that the gate accepts at `/_flowleap/callback`. */
const TOKEN_PATTERN = /^[A-Za-z0-9._-]+$/;

const FETCH_TIMEOUT_MS = 5000;

/** The token that the gate gives to the workbench. */
export interface IHostedGateSession {
	readonly token: string;
}

/**
 * Read the gate token from {@link HOSTED_GATE_SESSION_PATH}. Never throws: every failure
 * returns `undefined`, and the caller then falls back to the normal sign-in.
 */
export async function readHostedGateSession(fetchImpl: typeof fetch, logService: ILogService): Promise<IHostedGateSession | undefined> {
	try {
		const response = await fetchImpl(HOSTED_GATE_SESSION_PATH, {
			method: 'GET',
			credentials: 'same-origin',
			cache: 'no-store',
			redirect: 'error',
			headers: { [HOSTED_GATE_SESSION_HEADER]: '1' },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!response.ok) {
			logService.info(`[FlowLeap hosted] ${HOSTED_GATE_SESSION_PATH} answered ${response.status}; no gate session`);
			return undefined;
		}
		const body: { token?: unknown } = await response.json();
		if (typeof body?.token !== 'string' || !TOKEN_PATTERN.test(body.token)) {
			logService.warn(`[FlowLeap hosted] ${HOSTED_GATE_SESSION_PATH} answered without a well-formed token`);
			return undefined;
		}
		return { token: body.token };
	} catch (error) {
		logService.info(`[FlowLeap hosted] cannot read ${HOSTED_GATE_SESSION_PATH}: ${error}`);
		return undefined;
	}
}

CommandsRegistry.registerCommand(HOSTED_GATE_SESSION_COMMAND_ID, (accessor: ServicesAccessor): Promise<IHostedGateSession | undefined> | undefined => {
	const environmentService = accessor.get(IBrowserWorkbenchEnvironmentService);
	if (!environmentService.options?.hostedUserData || !environmentService.remoteAuthority) {
		return undefined;
	}
	return readHostedGateSession(fetch, accessor.get(ILogService));
});
