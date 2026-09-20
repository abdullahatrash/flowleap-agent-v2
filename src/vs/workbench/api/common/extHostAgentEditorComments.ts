/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { Event } from '../../../base/common/event.js';

/**
 * A provider that reports "this resource accepts no comments" and stays that way.
 *
 * It satisfies the whole {@link vscode.AgentEditorCommentsProvider} contract: `comments` is always
 * empty, `acceptsComments` is always `false`, both events never fire, and `addComment` /
 * `deleteComment` / `dispose` do nothing. An extension that wires comment UI to this provider hides
 * that UI, which is the behaviour we want.
 */
class InertAgentEditorCommentsProvider implements vscode.AgentEditorCommentsProvider {

	readonly comments: readonly vscode.AgentEditorComment[] = Object.freeze([]);
	readonly acceptsComments = false;
	readonly onDidChange = Event.None;
	readonly onDidRevealComment = Event.None;

	addComment(_range: vscode.Range, _body: string): void {
		// No session comment store exists, so there is nothing to add to.
	}

	deleteComment(_id: string): void {
		// No session comment store exists, so there is nothing to delete from.
	}

	dispose(): void {
		// Nothing is held: no RPC handle, no emitters, no listeners.
	}
}

/**
 * The FlowLeap stand-in for upstream's `ExtHostAgentEditorComments` — a **null object** in the same
 * shape as our GitHub-bypass authentication service (`PatentAIAuthService`, ADR 0002).
 *
 * Upstream's real implementation is one half of the agent-feedback comment stack: it allocates an RPC
 * handle, talks to `MainThreadAgentEditorComments`, and reads the session comment store in
 * `src/vs/sessions/contrib/agentFeedback/`. FlowLeap has none of that — no `agentFeedback`
 * contribution, no session comment store, no main-thread counterpart — and the patent workflows this
 * fork ships do not comment on agent edits.
 *
 * The seam exists only so that the bundled Markdown editor, which calls
 * `vscode.window.createAgentEditorComments` unconditionally, keeps compiling and running unchanged
 * against our fork. Because {@link vscode.AgentEditorCommentsProvider.acceptsComments} is `false`,
 * that editor hides its comment affordances, which is exactly the upstream behaviour for a resource
 * that is not in scope for a session. Keeping the null object here, rather than deleting the API call
 * from the extension, is what keeps `extensions/markdown-language-features` byte-identical to
 * upstream and therefore cheap to re-port.
 *
 * There is deliberately no `extHost.protocol.ts` entry and no `mainThread` counterpart: adding either
 * would imply a workbench-side store that does not exist. If FlowLeap ever wants real agent comments,
 * port `sessions/contrib/agentFeedback` and replace this class outright.
 */
export class ExtHostAgentEditorComments {

	createAgentEditorComments(_uri: vscode.Uri): vscode.AgentEditorCommentsProvider {
		return new InertAgentEditorCommentsProvider();
	}
}
