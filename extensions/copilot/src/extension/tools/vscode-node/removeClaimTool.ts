/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ClaimRemoval, removeClaim } from '../common/drafting/claims';
import { addRecordLine, CLAIM_REMOVED, emptyWorkingRecord } from '../common/drafting/workingRecord';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { DraftingWorkspace, textResult } from './draftingWorkspace';

interface IRemoveClaimParams {
	/** The matter folder name under `drafting/`. */
	matter: string;
	/** The number of the claim to remove, as `claims.md` numbers it now. */
	claim: number;
}

type ClaimsRemoved = Extract<ClaimRemoval, { removed: true }>;

/** The claims after the removed claim, before and after the removal: "claims 5 to 14 are now claims 4 to 13". */
function renumberingSentence(removal: ClaimsRemoved): string {
	const { renumbered } = removal;
	if (!renumbered.length) {
		return l10n.t('No other claim is renumbered.');
	}
	if (renumbered.length === 1) {
		return l10n.t('Claim {0} is now claim {1}.', renumbered[0].from, renumbered[0].to);
	}
	const first = renumbered[0];
	const last = renumbered[renumbered.length - 1];
	if (last.from - first.from === renumbered.length - 1) {
		return l10n.t('Claims {0} to {1} are now claims {2} to {3}.', first.from, last.from, first.to, last.to);
	}
	return l10n.t('Claims {0} are now claims {1}.', renumbered.map(entry => entry.from).join(', '), renumbered.map(entry => entry.to).join(', '));
}

/**
 * Removes one claim from `claims.md` of a drafting matter (PRD 0025, S5) through
 * {@link removeClaim}: the claim goes, the later claims move down by one, and the claim
 * references in the other claims change with them. It refuses, and writes nothing, when another
 * claim refers to the claim.
 *
 * {@link prepareInvocation} asks the attorney to confirm the removal and states its cost, the
 * re-opened claims approval (the `newCycle` pattern of `render_figure`). VS Code runs
 * {@link invoke} only after the click. The approval closes in code, not by the confirmation:
 * the edit changes the claims body, so {@link DraftingWorkspace.checkClaimsApproval} sets
 * `approved: false`. A skipped confirmation thus opens no gate.
 */
export class RemoveClaimTool implements ICopilotTool<IRemoveClaimParams> {

	public static readonly toolName = ToolName.RemoveClaim;

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IRemoveClaimParams>, _token: CancellationToken): Promise<vscode.PreparedToolInvocation> {
		const { matter, claim } = options.input;
		const invocationMessage = l10n.t('Removing claim {0} of {1}', claim, matter);
		const workspace = await DraftingWorkspace.locate(matter, this.workspaceService, this.fileSystemService, this.instantiationService);
		if (typeof workspace === 'string') {
			return { invocationMessage };
		}
		const removal = removeClaim(await workspace.read(workspace.folder.claims) ?? '', claim);
		if (!removal.removed) {
			// The call refuses anyway: nothing to confirm.
			return { invocationMessage };
		}
		return {
			invocationMessage,
			confirmationMessages: {
				title: l10n.t('Remove Claim'),
				message: l10n.t('Remove claim {0} of {1} from {2}? {3} This re-opens the claims approval: you approve the claims again before drafting continues.', claim, removal.before, workspace.folder.claims, renumberingSentence(removal)),
			},
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IRemoveClaimParams>, _token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const { matter, claim } = options.input;
		const refused = `Claim ${claim} was not removed.`;
		const workspace = await DraftingWorkspace.locate(matter, this.workspaceService, this.fileSystemService, this.instantiationService);
		if (typeof workspace === 'string') {
			return textResult(`${refused} ${workspace}`);
		}
		const { folder } = workspace;
		if (await workspace.read(folder.claims) === undefined) {
			return workspace.refusal(refused, `${folder.claims} does not exist.`);
		}
		// Ties an approval that no tool has read yet to the current claims body first, so the edit
		// below cannot carry it over to the changed claims.
		await workspace.checkClaimsApproval();
		const removal = removeClaim(await workspace.read(folder.claims) ?? '', claim);
		if (!removal.removed) {
			return workspace.refusal(refused, removal.reason === 'no-claim'
				? `${folder.claims} has no claim ${claim}.`
				: `${removal.dependents.length > 1 ? `Claims ${removal.dependents.join(', ')} refer` : `Claim ${removal.dependents[0]} refers`} to claim ${claim}. The attorney decides about ${removal.dependents.length > 1 ? 'those claims' : 'that claim'} first: remove ${removal.dependents.length > 1 ? 'them, the highest number first,' : 'it'} or change the claim ${removal.dependents.length > 1 ? 'they refer' : 'it refers'} to.`);
		}
		await workspace.write(folder.claims, removal.text);
		const renumbering = renumberingSentence(removal);
		const record = await workspace.read(folder.workingRecord) ?? emptyWorkingRecord(folder.matter);
		await workspace.write(folder.workingRecord, addRecordLine(record, CLAIM_REMOVED, `${new Date().toISOString()} claim ${claim} of ${removal.before}, on the attorney's confirmation. ${renumbering}`));
		const approval = await workspace.checkClaimsApproval();
		const reopened = approval.cleared
			? `This re-opened the claims approval: \`approved\` in ${folder.claims} is now \`false\`. The attorney reviews the claims and approves them again; then call start_application_draft.`
			: `The claims were not approved before the removal; the attorney approves them after review.`;
		return textResult(`Removed claim ${claim} of ${removal.before} from ${folder.claims}. ${renumbering} The claim references in the other claims changed with them. ${reopened} ${await workspace.checklistLine(false)}`.trim());
	}
}

ToolRegistry.registerTool(RemoveClaimTool);
