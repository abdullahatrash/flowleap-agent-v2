/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFiguresSettings } from '../../../tools/common/drafting/figures';
import { checkClaimedFeatureCoverage, checkFigureProposals, checkFiguresSettings } from '../../../tools/common/drafting/figureValidators';
import { filingManifest, renderFilingManifest } from '../../../tools/common/drafting/filingManifest';
import { DraftFinding, findingLine } from '../../../tools/common/drafting/finding';
import { blockingFindings, mergeFindings, parseFindingsFile } from '../../../tools/common/drafting/findingsFile';
import { DRAFTING_FILE_NAMES, isDrawingSheetFile, resolveDraftingFolder } from '../../../tools/common/drafting/folderContract';
import { parseDraftOutline } from '../../../tools/common/drafting/outline';
import { parseFigureParts } from '../../../tools/common/drafting/specValidators';
import { checkDiagramSvg } from '../../common/diagram/diagramFaults';
import { numeralFor } from '../../common/diagram/diagramText';
import { checkFigureSvgFaults, checkSceneFaults, DRAWING_RULES } from '../../common/scene/drawingFaults';
import { validateScene } from '../../common/scene/sceneValidator';
import { CheckResult, FigureFinding, FigureSetFacts, runSheetChecks, SHEET_CHECKS, writeDrawingsReceipt } from '../../common/sheets/receipt';
import { DrawingPageSize, FigureInput, layoutDrawingSheets } from '../../common/sheets/sheetLayout';
import { DIAGRAM_SVG_CHECKS, DiagramSource, FigureId, figureListText, figureOfSvgFile, figureSetStatus, parseReviewRounds, reviewRecords, ROUNDS_FILE } from '../../common/drawingFiles';
import { MatterFiles, readMatterOffice } from './matterFiles';

/** The result of a build: the written Drawing Set, or the refusal reason (nothing was written). */
export type BuildDrawingSetResult =
	| {
		readonly ok: true;
		/** The result text for the model: the receipt counts and every failing check. */
		readonly text: string;
		readonly sheets: number;
		readonly pageSize: DrawingPageSize;
		readonly checks: readonly CheckResult[];
		/** True when `filing-manifest.md` was rewritten with the measured sheet count. */
		readonly manifestUpdated: boolean;
		/** The Figures of the figure list not drawn; not empty only for a partial build. */
		readonly missing: readonly string[];
	}
	| { readonly ok: false; readonly reason: string };

/** One check row as a result line, with its rule citation. */
function checkLine(check: CheckResult): string {
	return `- \`${check.id}\` [${check.citation}]: ${check.detail}`;
}

/** The source of a Figure, read back from `FIG-N.scene.json`: a 2D Figure carries `mode`. */
type FigureSource = DiagramSource | { readonly mode?: undefined };

/** The Figure-level findings, re-run on the files as they are now. */
async function figureFindings(files: MatterFiles, figure: FigureId, svg: string, allowedNumerals: readonly string[]): Promise<FigureFinding[]> {
	const file = `FIG-${figure.key}.svg`;
	const sourceText = await files.read(`drawings/FIG-${figure.key}.scene.json`);
	let source: FigureSource | undefined;
	try {
		source = sourceText === undefined ? undefined : JSON.parse(sourceText);
	} catch {
		source = undefined;
	}
	if (source?.mode === 'flowchart' || source?.mode === 'block') {
		const input = source.input;
		const count = source.mode === 'flowchart' ? source.input.steps.length : source.input.blocks.length;
		const numerals = Array.from({ length: count }, (_, index) => numeralFor(input.scheme, input.figure, index));
		return [...checkDiagramSvg(svg, { office: input.office, figure: input.figure, numerals }), ...checkFigureSvgFaults(svg, { file, checks: DIAGRAM_SVG_CHECKS })];
	}
	const scene = source ? validateScene(source).scene : undefined;
	return [...(scene ? checkSceneFaults(scene, allowedNumerals) : []), ...checkFigureSvgFaults(svg, { file })];
}

/**
 * Applies the attorney's waivers of `findings.md` to the Figure findings: an Error is waived when
 * `findings.md` has a waived item with the same rule id, and with the same file when the item
 * names one (`- \`lead-lines-cross\` (FIG-1.svg): ...` then `  - Waived: <reason>`).
 */
function withFigureWaivers(findings: readonly FigureFinding[], previous: readonly DraftFinding[]): FigureFinding[] {
	const waivers = previous.filter(item => item.waived);
	return findings.map(finding => {
		const waiver = finding.severity === 'Error' ? waivers.find(item => item.rule === finding.rule && (!item.file || item.file === finding.file)) : undefined;
		return waiver ? { ...finding, waived: waiver.waived } : finding;
	});
}

/** Options of a build. */
export interface BuildDrawingSetOptions {
	/**
	 * Build for review although Figures of the figure list are not drawn: the receipt starts with
	 * `INCOMPLETE SET: ... not drawn` and the Filing Manifest is not rewritten.
	 */
	readonly partial?: boolean;
}

/**
 * Builds the Drawing Set of a drafting matter (PRD 0023, slice D5) from every `drawings/FIG-N.svg`.
 * It refuses, and writes nothing, when there is no Figure, when a Figure a heading of `figures.md`
 * names is not drawn (`figures-missing`; a range heading `FIGS. 7 to 10` names each member) unless
 * `options.partial` is set, on a `(proposed)` part in `figures.md`,
 * on an unwaived Error of the figure-list checks (page size for the office, claimed-feature
 * coverage) or of the Figure checks re-run on the written files, on a layout refusal and on a
 * failing sheet check. Waivers are `  - Waived: <reason>` lines in `findings.md`. Otherwise it
 * writes `drawings/sheet-N.svg` (older sheets removed), `drawings/review/sheet-N.png`,
 * `drawings/drawings.pdf` and the receipt `drawings/drawings-compliance.md`, and rewrites
 * `filing-manifest.md` with the measured sheet count when the export already wrote it. A partial
 * build lays the FIG labels out by the figure-list count, starts the receipt with
 * `INCOMPLETE SET: <Figures> not drawn` and never rewrites the manifest. No model call.
 */
export async function buildDrawingSetOp(files: MatterFiles, options: BuildDrawingSetOptions = {}): Promise<BuildDrawingSetResult> {
	const refuse = (reason: string): BuildDrawingSetResult => ({ ok: false, reason });
	const drawings = `${files.folder}/drawings`;
	const path = (name: string) => `${files.folder}/${name}`;
	const figures = await files.read(DRAFTING_FILE_NAMES.figures);
	if (figures === undefined) {
		return refuse(`${path(DRAFTING_FILE_NAMES.figures)} does not exist.`);
	}
	const draft = await files.read(DRAFTING_FILE_NAMES.draft);
	const office = await readMatterOffice(files);
	if (!office) {
		return refuse(`Neither ${path(DRAFTING_FILE_NAMES.draft)} nor ${path(DRAFTING_FILE_NAMES.featureList)} names the office (\`office: US\` or \`office: EPO\`).`);
	}
	const figureFiles = (await files.listFiles('drawings'))
		.map(name => figureOfSvgFile(name))
		.filter((figure): figure is FigureId => figure !== undefined)
		.sort((a, b) => a.number - b.number || (a.partial ?? '').localeCompare(b.partial ?? ''));
	if (!figureFiles.length) {
		return refuse(`${drawings}/ has no Figure (FIG-N.svg). Render each Figure with render_figure first.`);
	}
	const status = figureSetStatus(figures, figureFiles);
	const figureSet: FigureSetFacts = { expected: status.expected.length, missing: figureListText(status.missing) };
	if (status.missing.length && !options.partial) {
		return refuse(`\`figures-missing\`: ${figureSet.missing} of ${path(DRAFTING_FILE_NAMES.figures)} ${status.missing.length === 1 ? 'is' : 'are'} not drawn (${SHEET_CHECKS['figures-missing']}). Render ${status.missing.length === 1 ? 'it' : 'each'} with render_figure first. To review the Figures drawn so far, build with the partial option (\`partial: true\`; CLI \`--partial\`): the receipt then starts with "INCOMPLETE SET" and the Filing Manifest is not changed.`);
	}

	const proposals = checkFigureProposals(figures);
	if (proposals.length) {
		return refuse(`${path(DRAFTING_FILE_NAMES.figures)} has ${proposals.length} proposed part(s); the attorney confirms each by removing "(proposed)", or deletes the line:\n${proposals.map(findingLine).join('\n')}`);
	}
	const previous = parseFindingsFile(await files.read(DRAFTING_FILE_NAMES.findings) ?? '');
	const outline = parseDraftOutline(await files.read(DRAFTING_FILE_NAMES.draftOutline) ?? '');
	const listChecks: DraftFinding[] = [
		...checkFiguresSettings(figures, office),
		...checkClaimedFeatureCoverage({ office, figures, outline, featureList: await files.read(DRAFTING_FILE_NAMES.featureList) ?? '' }),
	];
	const blocking = blockingFindings(mergeFindings(listChecks, previous));
	if (blocking.length) {
		return refuse(`${blocking.length} Error(s) of the figure list are open; fix each in ${path(DRAFTING_FILE_NAMES.figures)}, or the attorney waives it in ${path(DRAFTING_FILE_NAMES.findings)}:\n${blocking.map(findingLine).join('\n')}`);
	}

	const allowedNumerals = [...new Set(parseFigureParts(figures).map(part => part.numeral))];
	const inputs: FigureInput[] = [];
	const found: FigureFinding[] = [];
	for (const figure of figureFiles) {
		const svg = await files.read(`drawings/FIG-${figure.key}.svg`) ?? '';
		inputs.push({ number: figure.number, partial: figure.partial, svg });
		found.push(...await figureFindings(files, figure, svg, allowedNumerals));
	}
	const figureFindingsWaived = withFigureWaivers(found, previous);
	const openFigureErrors = blockingFindings(figureFindingsWaived);
	if (openFigureErrors.length) {
		return refuse(`${openFigureErrors.length} Error(s) of the Figures are open. Fix each in the Figure source and render again, or the attorney waives it: copy the item under "## Errors" in ${path(DRAFTING_FILE_NAMES.findings)} and add a line \`  - Waived: <reason>\` under it.\n${openFigureErrors.map(findingLine).join('\n')}`);
	}
	const { pageSize } = readFiguresSettings(figures);
	const layout = layoutDrawingSheets(office, pageSize, inputs, { figureCount: figureSet.expected });
	if (!layout.ok) {
		return refuse(layout.reason);
	}
	const sheets = layout.sheets.map(sheet => sheet.svg);
	const sheetFails = runSheetChecks(office, pageSize, sheets, undefined, figureSet).filter(check => check.result === 'fail');
	if (sheetFails.length) {
		return refuse(`${sheetFails.length} sheet check(s) fail:\n${sheetFails.map(checkLine).join('\n')}`);
	}

	const [{ rasterizeSvg }, { inspectPdf, renderDrawingsPdf }] = await Promise.all([import('../raster/rasterize'), import('../pdf/drawingsPdf')]);
	for (const name of await files.listFiles('drawings')) {
		if (isDrawingSheetFile(name)) {
			await files.delete(`drawings/${name}`);
		}
	}
	for (let index = 0; index < sheets.length; index++) {
		await files.write(`drawings/sheet-${index + 1}.svg`, sheets[index]);
		await files.write(`drawings/review/sheet-${index + 1}.png`, (await rasterizeSvg(sheets[index])).png);
	}
	const draftingFolder = resolveDraftingFolder(files.folder.split('/').pop() ?? '');
	const pdfBytes = await renderDrawingsPdf(sheets, { title: `Drawings, ${draftingFolder?.matter ?? files.folder}` });
	await files.write('drawings/drawings.pdf', pdfBytes);
	const rounds = parseReviewRounds(await files.read(`drawings/${ROUNDS_FILE}`));
	const receipt = writeDrawingsReceipt({
		office,
		pageSize,
		sheets,
		figureRules: DRAWING_RULES,
		figureFindings: figureFindingsWaived,
		reviewRounds: reviewRecords(rounds, figureFiles.map(figure => figure.key)),
		pdf: inspectPdf(pdfBytes),
		date: new Date().toISOString().slice(0, 10),
		figureSet,
	});
	const receiptPath = `${drawings}/drawings-compliance.md`;
	await files.write('drawings/drawings-compliance.md', receipt.markdown);

	let manifestUpdated = false;
	let manifestLine = `The Filing Manifest is written by export_draft_docx; it will count the ${sheets.length} sheet(s).`;
	const claims = await files.read(DRAFTING_FILE_NAMES.claims);
	if (status.missing.length) {
		manifestLine = `${path(DRAFTING_FILE_NAMES.filingManifest)} was not changed: a partial build never counts as the Drawing Set.`;
	} else if (draftingFolder && draft !== undefined && claims !== undefined && await files.exists(DRAFTING_FILE_NAMES.filingManifest)) {
		const manifest = filingManifest({ office, draft, claims, figures, drawingFiles: await files.listFiles('drawings') });
		await files.write(DRAFTING_FILE_NAMES.filingManifest, renderFilingManifest(manifest, draftingFolder));
		manifestUpdated = true;
		manifestLine = `Updated ${path(DRAFTING_FILE_NAMES.filingManifest)}: ${manifest.drawingSheets} drawing sheet(s), measured.`;
	}

	const count = (result: CheckResult['result']) => receipt.checks.filter(check => check.result === result).length;
	const failing = receipt.checks.filter(check => check.result === 'fail');
	const text = [
		...(status.missing.length ? [`INCOMPLETE SET: ${figureSet.missing} not drawn. Built for review only (partial); do not present it as the Drawing Set.`] : []),
		`Built ${status.missing.length ? 'a partial set for review' : 'the Drawing Set'} of ${figureFiles.length} Figure(s) on ${sheets.length} ${pageSize} sheet(s) for ${office}: ${sheets.map((_, index) => `${drawings}/sheet-${index + 1}.svg`).join(', ')}, ${drawings}/drawings.pdf, and the receipt ${receiptPath}. Review renders of the sheets are in ${drawings}/review/.`,
		`Receipt: ${count('pass')} pass, ${count('fail')} fail, ${count('not-checked')} not checked.`,
		failing.length ? `Failing checks:\n${failing.map(checkLine).join('\n')}` : 'No code check fails.',
		manifestLine,
		'Report the receipt by check. The rules a person must judge (sufficient views, every claimed feature shown) stay with the attorney; never call the drawings compliant or ready to file.',
	].join('\n');
	return { ok: true, text, sheets: sheets.length, pageSize, checks: receipt.checks, manifestUpdated, missing: status.missing };
}
