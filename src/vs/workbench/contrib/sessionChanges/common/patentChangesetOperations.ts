/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AGENT_HOST_CHECKOUT_CHANGESET_OPERATION_ID, AGENT_HOST_MERGE_CHANGESET_OPERATION_ID, AGENT_HOST_PULL_REQUEST_OPERATION_IDS } from '../../../../platform/agentHost/common/agentHostChangesetOperationService.js';
import { PREPARE_PULL_REQUEST_OPERATION_ID } from '../../../../platform/agentHost/common/meta/agentPullRequestOperationMeta.js';

/**
 * FlowLeap Patent IDE (#471): changeset operations the Changes view does not
 * offer in Patent IDE mode. A patent workspace is a matter folder, not a
 * repository, so pull request, merge and checkout flows are developer-shaped.
 * Commit, sync and discard stay, because the host only advertises them when the
 * folder already is a git repository.
 *
 * The host keeps advertising these operations; only the presentation drops them,
 * so the agent host stays an upstream copy.
 */
const PATENT_HIDDEN_CHANGESET_OPERATION_IDS: ReadonlySet<string> = new Set([
	'create-pr',
	'create-draft-pr',
	'create-pr-auto-merge',
	'create-pr-auto-squash',
	'create-pr-auto-rebase',
	'create-pr-agent-merge',
	'create-draft-pr-agent-merge',
	PREPARE_PULL_REQUEST_OPERATION_ID,
	...AGENT_HOST_PULL_REQUEST_OPERATION_IDS,
	AGENT_HOST_MERGE_CHANGESET_OPERATION_ID,
	AGENT_HOST_CHECKOUT_CHANGESET_OPERATION_ID,
]);

export function isPatentHiddenChangesetOperation(operationId: string): boolean {
	return PATENT_HIDDEN_CHANGESET_OPERATION_IDS.has(operationId);
}
