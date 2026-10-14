/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The drawings CLI (PRD 0023, slice D6): the editor drawing tools `render_figure`,
 * `build_drawing_set` and `propose_figure_part` (D5) for the Agents Window skill
 * `patent-drawings`, with the same gates, refusals and files. Bundled to `dist/drawings-cli.js`
 * beside the kernel and resvg WebAssembly files.
 *
 * ```
 * drawings-cli render <matter> <figure> --scene <file> | --flowchart <file> | --block <file> [--seen no]
 * drawings-cli build <matter>
 * drawings-cli propose <matter> <figure> <part> [--numeral <n>] [--features F1,F2] [--sketch <file>]
 * ```
 *
 * `<figure>` is `1`, `1A` or `FIG-1A`. `--root <dir>` is the workspace that holds `drafting/`
 * (default: the current folder). Input files are read relative to the current folder; a sketch
 * path is workspace-relative, or `sketches/<file>` relative to the matter folder.
 *
 * Output: one JSON object on stdout. Exit 0 on success, 1 on a refusal (`ok: false` and the
 * reason, the same text the editor tool gives), 2 on a usage error. No model call.
 */

import { createHash } from 'crypto';
import { existsSync, promises as fs } from 'fs';
import * as path from 'path';
import type { DiagramBlock, DiagramConnection } from '../../common/diagram/blockDiagram';
import type { DiagramResult } from '../../common/diagram/diagram';
import type { FlowchartProposal } from '../../common/diagram/flowchart';
import type { DiagramStep } from '../../common/diagram/steps';
import { DIAGRAM_SVG_CHECKS, DiagramSource, drawingFindingLine, FigureId, figureId, figureOfSvgFile, insertPartLine, MAX_REVIEW_ROUNDS, nextNumeral, parseReviewRounds, partsOfFigure, renderReviewRounds, reviewPngCount, reviewRecords, ReviewRound, ROUNDS_FILE, sameBytes, schemeFault, SKETCH_EXTENSIONS, sketchFileName } from '../../common/drawingFiles';
import { checkFigureSvgFaults, checkSceneFaults, DRAWING_RULES, DrawingFinding } from '../../common/scene/drawingFaults';
import type { DrawingScene } from '../../common/scene/drawingScene';
import { validateScene } from '../../common/scene/sceneValidator';
import type { CheckResult } from '../../common/sheets/receipt';
import type { FigureInput } from '../../common/sheets/sheetLayout';
import { parseClaims } from '../../../tools/common/drafting/claims';
import { checkClaimedFeatureCoverage, checkFigureProposals, checkFiguresSettings } from '../../../tools/common/drafting/figureValidators';
import { formatFigurePart, readFiguresSettings } from '../../../tools/common/drafting/figures';
import { DraftFinding } from '../../../tools/common/drafting/finding';
import { blockingFindings, mergeFindings, parseFindingsFile } from '../../../tools/common/drafting/findingsFile';
import { filingManifest, renderFilingManifest } from '../../../tools/common/drafting/filingManifest';
import { DraftingFolder, isDrawingSheetFile, resolveDraftingFolder } from '../../../tools/common/drafting/folderContract';
import { DraftingOffice, parseDraftingFrontmatter, readGateFlag, readOffice } from '../../../tools/common/drafting/frontmatter';
import { parseDraftOutline } from '../../../tools/common/drafting/outline';
import { figureHeadingNumbers, hasFigure, parseFigureParts, parseFigureSections } from '../../../tools/common/drafting/specValidators';

/** A JSON value of the CLI output. */
type CliValue = string | number | boolean | undefined | readonly CliValue[] | { readonly [key: string]: CliValue };

/** The JSON object on stdout. */
export type CliOutput = {
	readonly ok: boolean;
	readonly command: string;
	/** The reason of a refusal or a usage error. */
	readonly reason?: string;
	readonly [key: string]: CliValue;
};

/** What one CLI run prints and exits with. */
export interface CliResult {
	readonly exitCode: 0 | 1 | 2;
	readonly output: CliOutput;
}

/** A Finding as the CLI prints it. */
type CliFinding = {
	readonly severity: string;
	readonly rule: string;
	readonly message: string;
	readonly file?: string;
	readonly citation?: string;
};

/** Thrown for a refusal; the message is the reason. */
class Refusal extends Error { }

/** Thrown for a usage error. */
class UsageError extends Error { }

const USAGE = 'Usage: drawings-cli render <matter> <figure> --scene <file> | --flowchart <file> | --block <file> [--seen no]; drawings-cli build <matter>; drawings-cli propose <matter> <figure> <part> [--numeral <n>] [--features F1,F2] [--sketch <file>]. Option: --root <workspace>.';

/** The parsed command line: positional arguments and `--name value` options. */
interface ParsedArgs {
	readonly positional: readonly string[];
	readonly options: ReadonlyMap<string, string>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
	const positional: string[] = [];
	const options = new Map<string, string>();
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith('--')) {
			const value = argv[i + 1];
			if (value === undefined || value.startsWith('--')) {
				throw new UsageError(`Option ${arg} needs a value.`);
			}
			options.set(arg.slice(2), value);
			i++;
		} else {
			positional.push(arg);
		}
	}
	return { positional, options };
}

function toCliFinding(finding: DraftFinding & { readonly citation?: string }): CliFinding {
	return {
		severity: finding.severity,
		rule: finding.rule,
		message: finding.message,
		...(finding.file ? { file: finding.file } : {}),
		...(finding.citation ? { citation: finding.citation } : {}),
	};
}

/** One matter folder on disk, with the drafting folder contract and workspace-relative file access. */
class Matter {

	private constructor(readonly root: string, readonly folder: DraftingFolder) { }

	static locate(root: string, name: string | undefined): Matter {
		const folder = name === undefined ? undefined : resolveDraftingFolder(name);
		if (!folder) {
			throw new UsageError(`"${name ?? ''}" is not a matter name. Give the folder name under drafting/, e.g. "widget".`);
		}
		const matter = new Matter(root, folder);
		if (!existsSync(matter.abs(folder.folder))) {
			throw new Refusal(`${folder.folder}/ does not exist in the workspace ${root}.`);
		}
		return matter;
	}

	abs(workspacePath: string): string {
		return path.join(this.root, ...workspacePath.split('/'));
	}

	async read(workspacePath: string): Promise<string | undefined> {
		try {
			return await fs.readFile(this.abs(workspacePath), 'utf8');
		} catch {
			return undefined;
		}
	}

	async readBytes(workspacePath: string): Promise<Uint8Array | undefined> {
		try {
			return new Uint8Array(await fs.readFile(this.abs(workspacePath)));
		} catch {
			return undefined;
		}
	}

	async write(workspacePath: string, content: string | Uint8Array): Promise<void> {
		const file = this.abs(workspacePath);
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, content);
	}

	/** The file names in a workspace-relative folder, sorted; empty when it does not exist. */
	async listFiles(workspacePath: string): Promise<string[]> {
		const entries = await fs.readdir(this.abs(workspacePath), { withFileTypes: true }).catch(() => []);
		return entries.filter(entry => entry.isFile()).map(entry => entry.name).sort();
	}

	/** The office of the draft: the draft's frontmatter, else the Feature List's. */
	async office(draft: string | undefined): Promise<DraftingOffice | undefined> {
		const fromDraft = draft ? readOffice(parseDraftingFrontmatter(draft).fields) : undefined;
		if (fromDraft) {
			return fromDraft;
		}
		const featureList = await this.read(this.folder.featureList);
		return featureList ? readOffice(parseDraftingFrontmatter(featureList).fields) : undefined;
	}

	/**
	 * The `approved` gate of `claims.md`, read only: the claims text, or the refusal. Unlike the
	 * editor tools, the CLI does not clear the flag when the claims changed after approval; it
	 * refuses and the editor's drafting tools clear it on their next call.
	 */
	async approvedClaims(): Promise<string> {
		const path = this.folder.claims;
		const text = await this.read(path);
		if (text === undefined) {
			throw new Refusal(`A flowchart from a claim needs the Approved Claims. ${path} does not exist. The attorney sets \`approved: true\` in its frontmatter after review.`);
		}
		const { fields, body } = parseDraftingFrontmatter(text);
		const gate = readGateFlag(fields, 'approved');
		if (gate !== 'set') {
			throw new Refusal(`A flowchart from a claim needs the Approved Claims. ${gate === 'missing'
				? `${path} has no \`approved\` flag in its frontmatter. The attorney sets \`approved: true\` after review; a statement in chat does not open this gate.`
				: `\`approved\` in ${path} is not \`true\`. The attorney sets \`approved: true\` after review; a statement in chat does not open this gate.`}`);
		}
		const approvedHash = fields['approvedHash'];
		if (typeof approvedHash === 'string' && approvedHash !== createHash('sha256').update(body.trim()).digest('hex')) {
			throw new Refusal(`A flowchart from a claim needs the Approved Claims. ${path} changed after it was approved. The attorney reviews the claims and sets \`approved: true\` again.`);
		}
		return text;
	}
}

/** `1`, `1A`, `FIG-1A`, `fig. 2` as a Figure. */
function parseFigure(text: string | undefined): FigureId {
	const match = /^(?:fig(?:ure)?[-.\s]*)?(?<number>\d+)(?<partial>[A-Za-z])?$/i.exec((text ?? '').trim());
	const figure = match?.groups ? figureId(Number(match.groups.number), match.groups.partial) : `"${text ?? ''}" is not a Figure. Give its number, e.g. 1, 2A or FIG-1.`;
	if (typeof figure === 'string') {
		throw new UsageError(figure);
	}
	return figure;
}

/** A JSON object read from a file relative to the current folder. */
async function readJsonObject(cwd: string, file: string, what: string): Promise<object> {
	let text: string;
	try {
		text = await fs.readFile(path.resolve(cwd, file), 'utf8');
	} catch {
		throw new Refusal(`The ${what} file ${file} cannot be read.`);
	}
	try {
		const value: object | null = JSON.parse(text);
		if (typeof value !== 'object' || value === null || Array.isArray(value)) {
			throw new Error('not an object');
		}
		return value;
	} catch (error) {
		throw new Refusal(`The ${what} file ${file} is not a JSON object: ${error instanceof Error ? error.message : String(error)}.`);
	}
}

/** The flowchart input file, the `flowchart` parameter of `render_figure`. */
interface FlowchartParams {
	readonly steps?: readonly string[];
	readonly fromClaim?: number;
	readonly terminals?: boolean;
	readonly proposal?: FlowchartProposal;
}

/** The block input file, the `block` parameter of `render_figure`. */
interface BlockParams {
	readonly blocks: readonly DiagramBlock[];
	readonly connections?: readonly DiagramConnection[];
}

function isFlowchartParams(value: object): value is FlowchartParams {
	const params = value as FlowchartParams;
	return (params.steps === undefined || (Array.isArray(params.steps) && params.steps.every(step => typeof step === 'string')))
		&& (params.fromClaim === undefined || typeof params.fromClaim === 'number')
		&& (params.terminals === undefined || typeof params.terminals === 'boolean');
}

function isBlockParams(value: object): value is BlockParams {
	const params = value as BlockParams;
	return Array.isArray(params.blocks) && params.blocks.every(block => typeof block?.id === 'string' && typeof block?.label === 'string')
		&& (params.connections === undefined || (Array.isArray(params.connections) && params.connections.every(connection => typeof connection?.from === 'string' && typeof connection?.to === 'string')));
}

/** What one render produced, before anything is written. */
interface RenderedSource {
	readonly svg: string;
	readonly source: string;
	readonly findings: readonly DraftFinding[];
}

/** Checks the scene against the figure list, then renders it on the kernel (as `render_figure`). */
async function renderScene(input: object, figure: FigureId, figures: string): Promise<RenderedSource> {
	const allowedNumerals = [...new Set(parseFigureParts(figures).map(part => part.numeral))];
	const validation = validateScene({ ...input, figure: `FIG-${figure.key}` });
	if (!validation.scene) {
		throw new Refusal(`The scene does not follow the schema:\n${validation.findings.map(drawingFindingLine).join('\n')}`);
	}
	const scene: DrawingScene = validation.scene;
	const gate = checkSceneFaults(scene, allowedNumerals).filter(finding => finding.rule === 'part-without-numeral' || finding.rule === 'numeral-not-allowed');
	if (gate.length) {
		throw new Refusal(`Every part drawn has a numeral, and every numeral is in the figure list:\n${gate.map(drawingFindingLine).join('\n')}\nAdd the part to the figure list (propose when the disclosure does not state it), or remove it from the scene.`);
	}
	const { renderFigure } = await import('../kernel/figureRenderer');
	const result = await renderFigure(scene, { allowedNumerals });
	if (!result.svg) {
		throw new Refusal(`The scene could not be rendered:\n${result.findings.map(drawingFindingLine).join('\n')}`);
	}
	return { svg: result.svg, source: `${JSON.stringify(scene, null, '\t')}\n`, findings: [...validation.findings, ...result.findings] };
}

/** The steps given in order, or the steps of the approved method claim. */
async function flowchartSteps(matter: Matter, flowchart: FlowchartParams): Promise<DiagramStep[]> {
	if (flowchart.fromClaim === undefined) {
		const steps = (flowchart.steps ?? []).map(text => text.trim()).filter(Boolean);
		if (!steps.length) {
			throw new Refusal('Give the method steps in `steps`, or the number of an approved method claim in `fromClaim`.');
		}
		return steps.map((text, index) => ({ id: `s${index + 1}`, text }));
	}
	if (flowchart.steps?.length) {
		throw new Refusal('Give either `steps` or `fromClaim`, not both: the claim is the authority for the steps.');
	}
	const claims = await matter.approvedClaims();
	const claim = parseClaims(claims).find(item => item.number === flowchart.fromClaim);
	if (!claim) {
		throw new Refusal(`${matter.folder.claims} has no claim ${flowchart.fromClaim}.`);
	}
	const { stepsFromMethodClaim } = await import('../../common/diagram/steps');
	const steps = stepsFromMethodClaim(claim.text);
	if (!steps.length) {
		throw new Refusal(`Claim ${claim.number} has no steps to read (a method claim lists its steps after "comprising:").`);
	}
	return steps;
}

/** Builds the diagram input from the matter, checks its numerals against the figure list, then draws it (as `render_figure`). */
async function renderDiagram(matter: Matter, mode: 'flowchart' | 'block', input: object, figure: FigureId, figures: string): Promise<RenderedSource> {
	const { folder } = matter;
	const office = await matter.office(await matter.read(folder.draft));
	if (!office) {
		throw new Refusal(`Neither ${folder.draft} nor ${folder.featureList} names the office (\`office: US\` or \`office: EPO\`); a 2D Figure follows the office text rules.`);
	}
	const scheme = readFiguresSettings(figures).numerals;
	const fig = `FIG-${figure.key}`;
	let source: DiagramSource;
	let labels: string[];
	if (mode === 'flowchart') {
		if (!isFlowchartParams(input)) {
			throw new Refusal('The flowchart file is { "steps": ["...", "..."] } or { "fromClaim": <claim number> }, with optional "terminals" and "proposal".');
		}
		const steps = await flowchartSteps(matter, input);
		source = { figure: fig, mode: 'flowchart', input: { office, scheme, figure: figure.number, steps, terminals: input.terminals, proposal: input.proposal } };
		labels = steps.map(step => step.text);
	} else {
		if (!isBlockParams(input)) {
			throw new Refusal('The block file is { "blocks": [{ "id": "...", "label": "..." }], "connections": [{ "from": "...", "to": "..." }] }.');
		}
		source = { figure: fig, mode: 'block', input: { office, scheme, figure: figure.number, blocks: input.blocks, connections: input.connections ?? [] } };
		labels = input.blocks.map(block => block.label);
	}

	const { numeralFor } = await import('../../common/diagram/diagramText');
	const listed = new Set(partsOfFigure(figures, figure).map(part => part.numeral));
	const missing = labels.map((text, index) => ({ numeral: String(numeralFor(scheme, figure.number, index)), text })).filter(item => !listed.has(item.numeral));
	if (missing.length) {
		throw new Refusal(`Every numeral in a Figure is a numeral of the figure list (${DRAWING_RULES['numeral-not-allowed']}). The ${source.mode === 'flowchart' ? 'steps' : 'blocks'} of FIG. ${figure.key} take these numerals (\`numerals: ${scheme}\`), which are not under its heading in ${folder.figures}:\n${missing.map(item => `- ${item.numeral}: ${item.text}`).join('\n')}\nAdd these lines under the FIG. ${figure.key} heading, then render again.`);
	}

	let result: DiagramResult;
	if (source.mode === 'flowchart') {
		const { drawFlowchart } = await import('../../common/diagram/flowchart');
		result = await drawFlowchart(source.input);
	} else {
		const { drawBlockDiagram } = await import('../../common/diagram/blockDiagram');
		result = await drawBlockDiagram(source.input);
	}
	if (!result.svg) {
		throw new Refusal(`The diagram was refused:\n${result.findings.map(drawingFindingLine).join('\n')}`);
	}
	const svgFindings: DrawingFinding[] = checkFigureSvgFaults(result.svg, { file: `${fig}.svg`, checks: DIAGRAM_SVG_CHECKS });
	return { svg: result.svg, source: `${JSON.stringify(source, null, '\t')}\n`, findings: [...result.findings, ...svgFindings] };
}

async function render(args: ParsedArgs, root: string, cwd: string): Promise<CliOutput> {
	const matter = Matter.locate(root, args.positional[1]);
	const { folder } = matter;
	const figure = parseFigure(args.positional[2]);
	const modes = (['scene', 'flowchart', 'block'] as const).filter(mode => args.options.has(mode));
	if (modes.length !== 1) {
		throw new UsageError('Give exactly one of --scene (a 3D Figure), --flowchart or --block.');
	}
	const mode = modes[0];
	const figures = await matter.read(folder.figures);
	if (figures === undefined) {
		throw new Refusal(`${folder.figures} does not exist. Every numeral in a Figure is a numeral of the figure list, so write the figure list first.`);
	}
	const label = `FIG. ${figure.key}`;
	const sectionNumbers = parseFigureSections(figures).figures.flatMap(section => figureHeadingNumbers(section.label));
	if (!hasFigure(sectionNumbers, figure.key) && !hasFigure(sectionNumbers, String(figure.number))) {
		throw new Refusal(`${folder.figures} has no heading for ${label} (\`## ${label}\` with its parts). Add the Figure and its parts to the figure list first.`);
	}
	const rounds = parseReviewRounds(await matter.read(`${folder.drawings}/${ROUNDS_FILE}`));
	const done = Math.max(reviewPngCount(await matter.listFiles(`${folder.drawings}/review`), figure), rounds[figure.key]?.length ?? 0);
	if (done >= MAX_REVIEW_ROUNDS) {
		throw new Refusal(`${label} already had ${done} review rounds; the limit is ${MAX_REVIEW_ROUNDS} per Figure. Edit ${folder.drawings}/FIG-${figure.key}.scene.json by hand, or ask the attorney.`);
	}

	const input = await readJsonObject(cwd, args.options.get(mode)!, mode);
	const rendered = mode === 'scene' ? await renderScene(input, figure, figures) : await renderDiagram(matter, mode, input, figure, figures);

	const round = done + 1;
	const png = `review/FIG-${figure.key}.round-${round}.png`;
	const { rasterizeSvg } = await import('../raster/rasterize');
	const image = await rasterizeSvg(rendered.svg);
	await matter.write(`${folder.drawings}/FIG-${figure.key}.scene.json`, rendered.source);
	await matter.write(`${folder.drawings}/FIG-${figure.key}.svg`, rendered.svg);
	await matter.write(`${folder.drawings}/${png}`, image.png);
	const seen = args.options.get('seen') !== 'no';
	const record: ReviewRound = { round, png, seen };
	await matter.write(`${folder.drawings}/${ROUNDS_FILE}`, renderReviewRounds({ ...rounds, [figure.key]: [...(rounds[figure.key] ?? []), record] }));

	const errors = rendered.findings.filter(finding => finding.severity === 'Error');
	return {
		ok: true,
		command: 'render',
		figure: label,
		round,
		roundsLeft: MAX_REVIEW_ROUNDS - round,
		files: [`${folder.drawings}/FIG-${figure.key}.scene.json`, `${folder.drawings}/FIG-${figure.key}.svg`, `${folder.drawings}/${png}`, `${folder.drawings}/${ROUNDS_FILE}`],
		review: seen ? `${folder.drawings}/${png}` : undefined,
		errors: errors.length,
		findings: rendered.findings.map(toCliFinding),
		next: errors.length
			? `Fix the Errors in the source and render again${round < MAX_REVIEW_ROUNDS ? '' : '; this was the last round, so edit the scene file by hand or ask the attorney'}.`
			: 'The mechanical fault list found nothing. The attorney still reviews the Figure. Do not call it compliant or ready to file.',
	};
}

/** The Figure-level findings of the receipt, re-run on the files as they are now (as `build_drawing_set`). */
async function figureFindings(matter: Matter, figure: FigureId, svg: string, allowedNumerals: readonly string[]): Promise<DrawingFinding[]> {
	const file = `FIG-${figure.key}.svg`;
	const sourceText = await matter.read(`${matter.folder.drawings}/FIG-${figure.key}.scene.json`);
	let source: { readonly mode?: string } | undefined;
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

function checkLine(check: CheckResult): string {
	return `- \`${check.id}\` [${check.citation}]: ${check.detail}`;
}

function findingsLines(findings: readonly DraftFinding[]): string {
	return findings.map(finding => `- ${finding.severity} \`${finding.rule}\`${finding.line !== undefined ? ` (line ${finding.line})` : ''}: ${finding.message}${finding.waived ? ` (waived: ${finding.waived.reason})` : ''}`).join('\n');
}

async function build(args: ParsedArgs, root: string): Promise<CliOutput> {
	const matter = Matter.locate(root, args.positional[1]);
	const { folder } = matter;
	const figures = await matter.read(folder.figures);
	if (figures === undefined) {
		throw new Refusal(`${folder.figures} does not exist.`);
	}
	const draft = await matter.read(folder.draft);
	const office = await matter.office(draft);
	if (!office) {
		throw new Refusal(`Neither ${folder.draft} nor ${folder.featureList} names the office (\`office: US\` or \`office: EPO\`).`);
	}
	const figureFiles = (await matter.listFiles(folder.drawings))
		.map(name => figureOfSvgFile(name))
		.filter((figure): figure is FigureId => figure !== undefined)
		.sort((a, b) => a.number - b.number || (a.partial ?? '').localeCompare(b.partial ?? ''));
	if (!figureFiles.length) {
		throw new Refusal(`${folder.drawings}/ has no Figure (FIG-N.svg). Render each Figure first.`);
	}
	const proposals = checkFigureProposals(figures);
	if (proposals.length) {
		throw new Refusal(`${folder.figures} has ${proposals.length} proposed part(s); the attorney confirms each by removing "(proposed)", or deletes the line:\n${findingsLines(proposals)}`);
	}
	const outline = parseDraftOutline(await matter.read(folder.draftOutline) ?? '');
	const listChecks: DraftFinding[] = [
		...checkFiguresSettings(figures, office),
		...checkClaimedFeatureCoverage({ office, figures, outline, featureList: await matter.read(folder.featureList) ?? '' }),
	];
	const blocking = blockingFindings(mergeFindings(listChecks, parseFindingsFile(await matter.read(folder.findings) ?? '')));
	if (blocking.length) {
		throw new Refusal(`${blocking.length} Error(s) of the figure list are open; fix each in ${folder.figures}, or the attorney waives it in ${folder.findings}:\n${findingsLines(blocking)}`);
	}

	const allowedNumerals = [...new Set(parseFigureParts(figures).map(part => part.numeral))];
	const inputs: FigureInput[] = [];
	const findings: DrawingFinding[] = [];
	for (const figure of figureFiles) {
		const svg = await matter.read(`${folder.drawings}/FIG-${figure.key}.svg`) ?? '';
		inputs.push({ number: figure.number, partial: figure.partial, svg });
		findings.push(...await figureFindings(matter, figure, svg, allowedNumerals));
	}
	const { pageSize } = readFiguresSettings(figures);
	const [{ layoutDrawingSheets }, { runSheetChecks, writeDrawingsReceipt }] = await Promise.all([import('../../common/sheets/sheetLayout'), import('../../common/sheets/receipt')]);
	const layout = layoutDrawingSheets(office, pageSize, inputs);
	if (!layout.ok) {
		throw new Refusal(layout.reason);
	}
	const sheets = layout.sheets.map(sheet => sheet.svg);
	const sheetFails = runSheetChecks(office, pageSize, sheets).filter(check => check.result === 'fail');
	if (sheetFails.length) {
		throw new Refusal(`${sheetFails.length} sheet check(s) fail:\n${sheetFails.map(checkLine).join('\n')}`);
	}

	const [{ rasterizeSvg }, { inspectPdf, renderDrawingsPdf }] = await Promise.all([import('../raster/rasterize'), import('../pdf/drawingsPdf')]);
	for (const name of await matter.listFiles(folder.drawings)) {
		if (isDrawingSheetFile(name)) {
			await fs.rm(matter.abs(`${folder.drawings}/${name}`), { force: true });
		}
	}
	const files: string[] = [];
	for (let index = 0; index < sheets.length; index++) {
		await matter.write(`${folder.drawings}/sheet-${index + 1}.svg`, sheets[index]);
		await matter.write(`${folder.drawings}/review/sheet-${index + 1}.png`, (await rasterizeSvg(sheets[index])).png);
		files.push(`${folder.drawings}/sheet-${index + 1}.svg`, `${folder.drawings}/review/sheet-${index + 1}.png`);
	}
	const pdfBytes = await renderDrawingsPdf(sheets, { title: `Drawings, ${folder.matter}` });
	await matter.write(`${folder.drawings}/drawings.pdf`, pdfBytes);
	const rounds = parseReviewRounds(await matter.read(`${folder.drawings}/${ROUNDS_FILE}`));
	const receipt = writeDrawingsReceipt({
		office,
		pageSize,
		sheets,
		figureRules: DRAWING_RULES,
		figureFindings: findings,
		reviewRounds: reviewRecords(rounds, figureFiles.map(figure => figure.key)),
		pdf: inspectPdf(pdfBytes),
		date: new Date().toISOString().slice(0, 10),
	});
	const receiptPath = `${folder.drawings}/drawings-compliance.md`;
	await matter.write(receiptPath, receipt.markdown);
	files.push(`${folder.drawings}/drawings.pdf`, receiptPath);

	let manifest = `The Filing Manifest is written by the export; it will count the ${sheets.length} sheet(s).`;
	const claims = await matter.read(folder.claims);
	if (draft !== undefined && claims !== undefined && existsSync(matter.abs(folder.filingManifest))) {
		const values = filingManifest({ office, draft, claims, figures, drawingFiles: await matter.listFiles(folder.drawings) });
		await matter.write(folder.filingManifest, renderFilingManifest(values, folder));
		manifest = `Updated ${folder.filingManifest}: ${values.drawingSheets} drawing sheet(s), measured.`;
		files.push(folder.filingManifest);
	}

	const count = (result: CheckResult['result']) => receipt.checks.filter(check => check.result === result).length;
	return {
		ok: true,
		command: 'build',
		office,
		pageSize,
		figures: figureFiles.map(figure => `FIG. ${figure.key}`),
		sheets: sheets.length,
		files,
		receipt: {
			file: receiptPath,
			pass: count('pass'),
			fail: count('fail'),
			notChecked: count('not-checked'),
			failing: receipt.checks.filter(check => check.result === 'fail').map(checkLine),
		},
		manifest,
		next: 'Report the receipt by check. The rules a person must judge (sufficient views, every claimed feature shown) stay with the attorney; never call the drawings compliant or ready to file.',
	};
}

/** Copies the sketch to `sketches/` and returns its path relative to the matter folder (as `propose_figure_part`, without chat attachments). */
async function copySketch(matter: Matter, sketch: string): Promise<string> {
	const { folder } = matter;
	const sketchFolder = `${folder.folder}/sketches`;
	const relative = path.isAbsolute(sketch) ? path.relative(matter.root, sketch).split(path.sep).join('/') : sketch.replace(/\\/g, '/').replace(/^\.?\//, '');
	const workspacePath = relative.startsWith('sketches/') ? `${folder.folder}/${relative}` : relative;
	if (workspacePath.startsWith(`${sketchFolder}/`)) {
		if (!existsSync(matter.abs(workspacePath))) {
			throw new Refusal(`${workspacePath} does not exist.`);
		}
		return workspacePath.slice(folder.folder.length + 1);
	}
	const bytes = SKETCH_EXTENSIONS.test(workspacePath) && !workspacePath.split('/').includes('..') ? await matter.readBytes(workspacePath) : undefined;
	if (!bytes) {
		throw new Refusal(`"${sketch}" is not an image file in the workspace.`);
	}
	const fileName = sketchFileName(workspacePath);
	const dot = fileName.lastIndexOf('.');
	for (let index = 1; ; index++) {
		const candidate = index === 1 ? fileName : `${fileName.slice(0, dot)}-${index}${fileName.slice(dot)}`;
		const target = `${sketchFolder}/${candidate}`;
		const existing = await matter.readBytes(target);
		if (!existing) {
			await matter.write(target, bytes);
			return `sketches/${candidate}`;
		}
		if (sameBytes(existing, bytes)) {
			return `sketches/${candidate}`;
		}
	}
}

async function propose(args: ParsedArgs, root: string): Promise<CliOutput> {
	const matter = Matter.locate(root, args.positional[1]);
	const { folder } = matter;
	const figureText = args.positional[2];
	const figure = Number(figureText);
	if (!figureText || !Number.isInteger(figure) || figure < 1) {
		throw new UsageError('Give the figure number the part is drawn in: propose <matter> <figure> <part>.');
	}
	const part = args.positional.slice(3).join(' ').trim().replace(/\s+/g, ' ');
	if (!part || /[\[\]()]/.test(part)) {
		throw new Refusal('Give the part name, without brackets or parentheses.');
	}
	const features = (args.options.get('features')?.split(',') ?? []).map(feature => feature.trim().toUpperCase()).filter(Boolean);
	if (features.some(feature => !/^F\d+$/.test(feature))) {
		throw new Refusal('A Feature List link is a row id such as `F3`.');
	}
	const figures = await matter.read(folder.figures);
	if (figures === undefined) {
		throw new Refusal(`${folder.figures} does not exist.`);
	}
	const scheme = readFiguresSettings(figures).numerals;
	const parts = parseFigureParts(figures);
	let numeral = args.options.get('numeral')?.trim();
	if (numeral) {
		if (!/^\d{1,4}[a-z]?$/.test(numeral)) {
			throw new Refusal(`"${numeral}" is not a reference numeral (digits, then an optional small letter).`);
		}
		const used = parts.find(item => item.numeral === numeral);
		if (used) {
			throw new Refusal(`Numeral ${numeral} is already used for "${used.part}" (${folder.figures}, line ${used.line}). One numeral names one part.`);
		}
		const fault = schemeFault(numeral, scheme, figure);
		if (fault) {
			throw new Refusal(fault);
		}
	} else {
		numeral = nextNumeral(parts, scheme, figure);
		if (!numeral) {
			throw new Refusal(`FIG. ${figure} has no free numeral left in the ${figure}02 to ${figure}98 series.`);
		}
	}
	const sketch = args.options.get('sketch')?.trim();
	const source = sketch ? await copySketch(matter, sketch) : undefined;
	const line = formatFigurePart({ numeral, part, ...(features.length ? { features } : {}), proposed: source ? { source } : {} });
	await matter.write(folder.figures, insertPartLine(figures, figure, line));
	return {
		ok: true,
		command: 'propose',
		file: folder.figures,
		added: line,
		sketch: source ? `${folder.folder}/${source}` : undefined,
		next: 'This part is a proposal: build and the export stay blocked until the attorney confirms it by removing "(proposed)", or deletes the line. Tell the attorney what you proposed and why, then stop.',
	};
}

/** Runs one CLI command. Never throws: a refusal or a usage error is part of the result. */
export async function runDrawingsCli(argv: readonly string[], cwd: string = process.cwd()): Promise<CliResult> {
	let command = argv[0] ?? '';
	try {
		const args = parseArgs(argv);
		command = args.positional[0] ?? '';
		const root = path.resolve(cwd, args.options.get('root') ?? '.');
		switch (command) {
			case 'render': return { exitCode: 0, output: await render(args, root, cwd) };
			case 'build': return { exitCode: 0, output: await build(args, root) };
			case 'propose': return { exitCode: 0, output: await propose(args, root) };
			default: throw new UsageError(USAGE);
		}
	} catch (error) {
		if (error instanceof Refusal) {
			return { exitCode: 1, output: { ok: false, command, reason: error.message } };
		}
		if (error instanceof UsageError) {
			return { exitCode: 2, output: { ok: false, command, reason: error.message, usage: USAGE } };
		}
		return { exitCode: 1, output: { ok: false, command, reason: `The drawings engine failed: ${error instanceof Error ? error.message : String(error)}` } };
	}
}

if (require.main === module) {
	runDrawingsCli(process.argv.slice(2)).then(result => {
		process.stdout.write(`${JSON.stringify(result.output, undefined, 2)}\n`);
		process.exitCode = result.exitCode;
	});
}
