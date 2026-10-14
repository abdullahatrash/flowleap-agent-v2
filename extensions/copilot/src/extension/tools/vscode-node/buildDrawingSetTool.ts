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
import { checkFigureSvgFaults, checkSceneFaults, DRAWING_RULES, DrawingFinding } from '../../drawings/common/scene/drawingFaults';
import { validateScene } from '../../drawings/common/scene/sceneValidator';
import { CheckResult, runSheetChecks, writeDrawingsReceipt } from '../../drawings/common/sheets/receipt';
import { FigureInput, layoutDrawingSheets } from '../../drawings/common/sheets/sheetLayout';
import { readFiguresSettings } from '../common/drafting/figures';
import { checkClaimedFeatureCoverage, checkFigureProposals, checkFiguresSettings } from '../common/drafting/figureValidators';
import { filingManifest, renderFilingManifest } from '../common/drafting/filingManifest';
import { DraftFinding } from '../common/drafting/finding';
import { blockingFindings, mergeFindings, parseFindingsFile } from '../common/drafting/findingsFile';
import { isDrawingSheetFile } from '../common/drafting/folderContract';
import { parseDraftOutline } from '../common/drafting/outline';
import { parseFigureParts } from '../common/drafting/specValidators';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { DIAGRAM_SVG_CHECKS, FigureId, figureOfSvgFile, parseReviewRounds, reviewRecords, ROUNDS_FILE } from '../../drawings/common/drawingFiles';
import { DraftingWorkspace, findingLine, textResult } from './draftingWorkspace';

interface IBuildDrawingSetParams {
	/** The matter folder name under `drafting/`. */
	matter: string;
}

const refused = 'The Drawing Set was not built.';

/** The source of a Figure, read back from `FIG-N.scene.json`: a 2D Figure carries `mode`. */
interface FigureSourceShape {
	readonly mode?: string;
}

/** One check row as a result line, with its rule citation. */
function checkLine(check: CheckResult): string {
	return `- \`${check.id}\` [${check.citation}]: ${check.detail}`;
}

/**
 * Builds the Drawing Set of a drafting matter (PRD 0023, slice D5) from every `drawings/FIG-N.svg`:
 * it refuses on a `(proposed)` part in `figures.md`, an unwaived Error of the figure-list
 * validators (claimed-feature coverage included) or of the sheet checks, and when there is no
 * Figure. Otherwise it lays out the Drawing Sheets for the office and page size, writes
 * `sheet-N.svg`, the review renders, `drawings.pdf` and the receipt `drawings-compliance.md`, and
 * updates the Filing Manifest when the export has written one. It never says the set complies.
 */
export class BuildDrawingSetTool implements ICopilotTool<IBuildDrawingSetParams> {

	public static readonly toolName = ToolName.BuildDrawingSet;

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IBuildDrawingSetParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return { invocationMessage: l10n.t`Building the Drawing Set of ${options.input.matter}` };
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IBuildDrawingSetParams>, _token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const workspace = await DraftingWorkspace.locate(options.input.matter, this.workspaceService, this.fileSystemService, this.instantiationService);
		if (typeof workspace === 'string') {
			return textResult(`${refused} ${workspace}`);
		}
		const { folder } = workspace;
		const refusal = (reason: string) => textResult(`${refused} ${reason}`);
		const figures = await workspace.read(folder.figures);
		if (figures === undefined) {
			return refusal(`${folder.figures} does not exist.`);
		}
		const draft = await workspace.read(folder.draft);
		const office = await workspace.office(draft);
		if (!office) {
			return refusal(`Neither ${folder.draft} nor ${folder.featureList} names the office (\`office: US\` or \`office: EPO\`).`);
		}
		const figureFiles = (await workspace.listFiles(folder.drawings))
			.map(name => figureOfSvgFile(name))
			.filter((figure): figure is FigureId => figure !== undefined)
			.sort((a, b) => a.number - b.number || (a.partial ?? '').localeCompare(b.partial ?? ''));
		if (!figureFiles.length) {
			return refusal(`${folder.drawings}/ has no Figure (FIG-N.svg). Render each Figure with render_figure first.`);
		}

		const proposals = checkFigureProposals(figures);
		if (proposals.length) {
			return refusal(`${folder.figures} has ${proposals.length} proposed part(s); the attorney confirms each by removing "(proposed)", or deletes the line:\n${proposals.map(findingLine).join('\n')}`);
		}
		const outline = parseDraftOutline(await workspace.read(folder.draftOutline) ?? '');
		const listChecks: DraftFinding[] = [
			...checkFiguresSettings(figures, office),
			...checkClaimedFeatureCoverage({ office, figures, outline, featureList: await workspace.read(folder.featureList) ?? '' }),
		];
		const blocking = blockingFindings(mergeFindings(listChecks, parseFindingsFile(await workspace.read(folder.findings) ?? '')));
		if (blocking.length) {
			return refusal(`${blocking.length} Error(s) of the figure list are open; fix each in ${folder.figures}, or the attorney waives it in ${folder.findings}:\n${blocking.map(findingLine).join('\n')}`);
		}

		const allowedNumerals = [...new Set(parseFigureParts(figures).map(part => part.numeral))];
		const inputs: FigureInput[] = [];
		const figureFindings: DrawingFinding[] = [];
		for (const figure of figureFiles) {
			const svg = await workspace.read(`${folder.drawings}/FIG-${figure.key}.svg`) ?? '';
			inputs.push({ number: figure.number, partial: figure.partial, svg });
			figureFindings.push(...await this.figureFindings(workspace, figure, svg, allowedNumerals));
		}
		const { pageSize } = readFiguresSettings(figures);
		const layout = layoutDrawingSheets(office, pageSize, inputs);
		if (!layout.ok) {
			return refusal(layout.reason);
		}
		const sheets = layout.sheets.map(sheet => sheet.svg);
		const sheetFails = runSheetChecks(office, pageSize, sheets).filter(check => check.result === 'fail');
		if (sheetFails.length) {
			return refusal(`${sheetFails.length} sheet check(s) fail:\n${sheetFails.map(checkLine).join('\n')}`);
		}

		const [{ rasterizeSvg }, { inspectPdf, renderDrawingsPdf }] = await Promise.all([import('../../drawings/node/raster/rasterize'), import('../../drawings/node/pdf/drawingsPdf')]);
		for (const name of await workspace.listFiles(folder.drawings)) {
			if (isDrawingSheetFile(name)) {
				await workspace.delete(`${folder.drawings}/${name}`);
			}
		}
		for (let index = 0; index < sheets.length; index++) {
			await workspace.write(`${folder.drawings}/sheet-${index + 1}.svg`, sheets[index]);
			await workspace.write(`${folder.drawings}/review/sheet-${index + 1}.png`, (await rasterizeSvg(sheets[index])).png);
		}
		const pdfBytes = await renderDrawingsPdf(sheets, { title: `Drawings, ${folder.matter}` });
		await workspace.write(`${folder.drawings}/drawings.pdf`, pdfBytes);
		const rounds = parseReviewRounds(await workspace.read(`${folder.drawings}/${ROUNDS_FILE}`));
		const receipt = writeDrawingsReceipt({
			office,
			pageSize,
			sheets,
			figureRules: DRAWING_RULES,
			figureFindings,
			reviewRounds: reviewRecords(rounds, figureFiles.map(figure => figure.key)),
			pdf: inspectPdf(pdfBytes),
			date: new Date().toISOString().slice(0, 10),
		});
		const receiptPath = `${folder.drawings}/drawings-compliance.md`;
		await workspace.write(receiptPath, receipt.markdown);

		let manifestLine = `The Filing Manifest is written by export_draft_docx; it will count the ${sheets.length} sheet(s).`;
		const claims = await workspace.read(folder.claims);
		if (draft !== undefined && claims !== undefined && await workspace.exists(folder.filingManifest)) {
			const manifest = filingManifest({ office, draft, claims, figures, drawingFiles: await workspace.listFiles(folder.drawings) });
			await workspace.write(folder.filingManifest, renderFilingManifest(manifest, folder));
			manifestLine = `Updated ${folder.filingManifest}: ${manifest.drawingSheets} drawing sheet(s), measured.`;
		}

		const count = (result: CheckResult['result']) => receipt.checks.filter(check => check.result === result).length;
		const failing = receipt.checks.filter(check => check.result === 'fail');
		return textResult([
			`Built the Drawing Set of ${figureFiles.length} Figure(s) on ${sheets.length} ${pageSize} sheet(s) for ${office}: ${sheets.map((_, index) => `${folder.drawings}/sheet-${index + 1}.svg`).join(', ')}, ${folder.drawings}/drawings.pdf, and the receipt ${receiptPath}. Review renders of the sheets are in ${folder.drawings}/review/.`,
			`Receipt: ${count('pass')} pass, ${count('fail')} fail, ${count('not-checked')} not checked.`,
			failing.length ? `Failing checks:\n${failing.map(checkLine).join('\n')}` : 'No code check fails.',
			manifestLine,
			'Report the receipt by check. The rules a person must judge (sufficient views, every claimed feature shown) stay with the attorney; never call the drawings compliant or ready to file.',
		].join('\n'));
	}

	/** The Figure-level findings of the receipt, re-run on the files as they are now. */
	private async figureFindings(workspace: DraftingWorkspace, figure: FigureId, svg: string, allowedNumerals: readonly string[]): Promise<DrawingFinding[]> {
		const file = `FIG-${figure.key}.svg`;
		const sourceText = await workspace.read(`${workspace.folder.drawings}/FIG-${figure.key}.scene.json`);
		let source: FigureSourceShape | undefined;
		try {
			source = sourceText === undefined ? undefined : JSON.parse(sourceText);
		} catch {
			source = undefined;
		}
		if (source?.mode !== undefined) {
			return checkFigureSvgFaults(svg, { file, checks: DIAGRAM_SVG_CHECKS });
		}
		const scene = source ? validateScene(source).scene : undefined;
		return [...(scene ? checkSceneFaults(scene, allowedNumerals) : []), ...checkFigureSvgFaults(svg, { file })];
	}
}

ToolRegistry.registerTool(BuildDrawingSetTool);
