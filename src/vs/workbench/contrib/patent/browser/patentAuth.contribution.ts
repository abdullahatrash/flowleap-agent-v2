/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * Branded signed-out CTA in the core Accounts menu (PRD 0002 Issue 6).
 *
 * Core renders nothing in the Accounts menu for a registered-but-sessionless authentication
 * provider, so — exactly like GitHub Copilot's own `ChatSetupFromAccountsAction` — a signed-out
 * entry must be a custom {@link Action2} on the (non-extension-contributable) {@link MenuId.AccountsContext},
 * gated on a context key.
 *
 * It is shown only when the FlowLeap extension reports no session via the `flowleap.signedOut`
 * context key. That key is owned and set by the extension (PRD 0002 Issue 4); it is referenced here
 * by string on purpose, so core never becomes a second owner of it (a core `RawContextKey` would
 * collide). `has(...)` shows the item while signed out, hides it once signed in, and leaves it hidden
 * before the key is first set (acceptable — no auth prompt, no session enumeration). `run` invokes
 * the canonical `flowleap.signIn` command (PRD 0002 Issue 5), which routes through the native
 * `getSession({ createIfNone: true })` flow.
 */
class FlowLeapSignInFromAccountsAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.flowleap.signInFromAccounts',
			title: localize2('flowleapSignInFromAccounts', "Sign in to FlowLeap"),
			menu: {
				id: MenuId.AccountsContext,
				group: '2_flowleap',
				when: ContextKeyExpr.has('flowleap.signedOut')
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(ICommandService).executeCommand('flowleap.signIn');
	}
}

registerAction2(FlowLeapSignInFromAccountsAction);
