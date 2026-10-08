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
import { diffDraftParagraphs } from '../common/drafting/draftDiff';
import { OFFICE_PAGE_SETUP } from '../common/drafting/filingDocuments';
import { filingManifest, renderFilingManifest } from '../common/drafting/filingManifest';
import { blockingFindings } from '../common/drafting/findingsFile';
import { DRAFT_DOCUMENT_TYPES } from '../common/drafting/folderContract';
import { composeFullReviewCopy } from '../common/drafting/fullReviewCopy';
import { emptyWorkingRecord, withAttorneyEdits } from '../common/drafting/workingRecord';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { buildDraftDocx, buildFullReviewCopyDocx } from './draftDocx';
import { DraftingWorkspace, findingLine, textResult } from './draftingWorkspace';

interface IExportDraftDocxParams {
	/** The matter folder name under `drafting/`. */
	matter: string;
}

const refused = 'The draft was not exported.';

/**
 * Exports a Draft Application to one .docx per document type (`draft-application.description.docx`,
 * `.claims.docx`, `.abstract.docx`) with the office page setup (ADR 0012). It re-runs the
 * validators and refuses while an Error or an Inventor Question is open and unwaived, while
 * `approved` is not `true` in `claims.md`, or while `claims.md` differs from the claims the draft
 * was generated against. Otherwise it logs the attorney's edits against the generated snapshot in
 * the Working Record, strips the source markers, writes the .docx files and writes the filing
 * manifest (`filing-manifest.md`) and the full review copy (`draft-application.full.docx`, the whole
 * application in one file, not for filing) beside them. Drawings are not generated.
 */
export class ExportDraftDocxTool implements ICopilotTool<IExportDraftDocxParams> {

	public static readonly toolName = ToolName.ExportDraftDocx;

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IExportDraftDocxParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return {
			invocationMessage: l10n.t`Exporting the draft of ${options.input.matter} to Word`,
			confirmationMessages: {
				title: l10n.t`Export Draft Application`,
				message: l10n.t`Allow Patent AI to write the Word export of the draft of ${options.input.matter}?`,
			},
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IExportDraftDocxParams>, _token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const workspace = await DraftingWorkspace.locate(options.input.matter, this.workspaceService, this.fileSystemService, this.instantiationService);
		if (typeof workspace === 'string') {
			return textResult(`${refused} ${workspace}`);
		}
		const { folder } = workspace;
		const approval = await workspace.requireApprovedClaims();
		if (typeof approval === 'string') {
			return workspace.refusal(refused, approval);
		}
		if (approval.changed) {
			return workspace.refusal(refused, approval.changed);
		}
		const draft = await workspace.read(folder.draft);
		const snapshot = await workspace.read(folder.generatedSnapshot);
		const claims = await workspace.read(folder.claims);
		if (draft === undefined || snapshot === undefined || claims === undefined) {
			return workspace.refusal(refused, `${draft === undefined ? folder.draft : folder.generatedSnapshot} does not exist: save the draft with write_patent_results, template draft-application, first.`);
		}
		const office = await workspace.office(draft);
		if (!office) {
			return workspace.refusal(refused, `Neither ${folder.draft} nor ${folder.featureList} names the office (\`office: US\` or \`office: EPO\`).`);
		}
		const findings = await workspace.validate(office, draft, claims, approval, []);
		const blocking = blockingFindings(findings);
		if (blocking.length) {
			return workspace.refusal(refused, `${blocking.length} finding(s) in ${folder.findings} are open; each is resolved in the draft, or the attorney waives it with a reason (\`  - Waived: <reason>\` under the item):\n${blocking.map(findingLine).join('\n')}`);
		}
		const diff = diffDraftParagraphs(snapshot, draft);
		const record = await workspace.read(folder.workingRecord) ?? emptyWorkingRecord(folder.matter);
		await workspace.write(folder.workingRecord, withAttorneyEdits(record, diff, new Date().toISOString()));
		const documents = await buildDraftDocx(draft, office);
		for (const type of DRAFT_DOCUMENT_TYPES) {
			await workspace.write(folder.docx[type], documents[type]);
		}
		const figures = await workspace.read(folder.figures);
		const manifest = filingManifest({ office, draft, claims, figures });
		await workspace.write(folder.filingManifest, renderFilingManifest(manifest, folder));
		await workspace.recordExport(draft, claims);
		await workspace.write(folder.fullReviewCopy, await buildFullReviewCopyDocx(composeFullReviewCopy({ office, draft, figures, manifest }), office));
		const setup = OFFICE_PAGE_SETUP[office];
		const count = (kind: string) => diff.changes.filter(change => change.kind === kind).length;
		return textResult(`Exported the description, the claims and the abstract as separate files: ${DRAFT_DOCUMENT_TYPES.map(type => folder.docx[type]).join(', ')} (${setup.rule} page setup, ${setup.paper}; source markers and Inventor Questions section removed). Drawings are not generated: the drawing sheets for ${folder.figures} are prepared outside FlowLeap. Wrote ${folder.filingManifest}: ${manifest.claims.total} claim(s), ${manifest.claims.independent} independent; ${manifest.drawingSheets} drawing sheet(s); about ${manifest.pages.total} page(s) in total (estimated). Wrote the full review copy ${folder.fullReviewCopy}: the whole application in one file for reading, marked not for filing; each [MISSING: ...] placeholder in it names its checklist step. Attorney edits against the generated snapshot: ${diff.kept} paragraph(s) kept, ${count('changed')} changed, ${count('deleted')} deleted, ${count('added')} added; logged in ${folder.workingRecord}. The export is a draft for attorney review, not a filing. ${await workspace.checklistLine(false)}`);
	}
}

ToolRegistry.registerTool(ExportDraftDocxTool);
