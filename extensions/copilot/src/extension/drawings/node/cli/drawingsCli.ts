/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The drawings CLI (PRD 0023, slice D6): the same engine as the editor drawing tools, for the
 * Agents Window skill `patent-drawings`. Bundled to `dist/drawings-cli.js` beside the kernel and
 * resvg WebAssembly files.
 *
 * ```
 * drawings-cli render <matter> <figure> --scene <file> | --flowchart <file> | --block <file>
 * drawings-cli build <matter>
 * drawings-cli propose <matter> <numeral> <part> --sketch <file> [--figure <n>] [--features F1,F2]
 * ```
 *
 * Common options: `--root <dir>` (the workspace that holds `drafting/`; default: the current
 * folder) and `--office US|EPO|PCT` (when `feature-list.md` sets no office).
 *
 * Output: one JSON object on stdout. Exit 0 on success, 1 on a refusal (`ok: false` and the
 * reason), 2 on a usage error. No model call: every check is code.
 */

import { existsSync, promises as fs } from 'fs';
import * as path from 'path';
import type { DiagramResult } from '../../common/diagram/diagram';
import type { BlockDiagramInput, DiagramBlock, DiagramConnection } from '../../common/diagram/blockDiagram';
import type { FlowchartProposal } from '../../common/diagram/flowchart';
import type { DiagramStep } from '../../common/diagram/steps';
import type { DiagramNumeralScheme } from '../../common/diagram/diagramText';
import { checkFigureSvgFaults, checkSceneFaults, DRAWING_RULES } from '../../common/scene/drawingFaults';
import { validateScene } from '../../common/scene/sceneValidator';
import type { DrawingOffice, FigureInput } from '../../common/sheets/sheetLayout';
import type { FigureReviewRecord } from '../../common/sheets/receipt';
import { checkFigureProposals, checkFiguresSettings, checkClaimedFeatureCoverage } from '../../../tools/common/drafting/figureValidators';
import { formatFigurePart, readFiguresSettings } from '../../../tools/common/drafting/figures';
import { DraftFinding } from '../../../tools/common/drafting/finding';
import { parseFindingsFile } from '../../../tools/common/drafting/findingsFile';
import { filingManifest, renderFilingManifest } from '../../../tools/common/drafting/filingManifest';
import { DraftingFolder, DRAFTING_FILE_NAMES, isDrawingSheetFile, resolveDraftingFolder } from '../../../tools/common/drafting/folderContract';
import { DraftingOffice, parseDraftingFrontmatter, readOffice } from '../../../tools/common/drafting/frontmatter';
import { parseDraftOutline } from '../../../tools/common/drafting/outline';
import { figureHeadingNumbers, figureNumbers, hasFigure, parseFigureParts, parseFigureSections } from '../../../tools/common/drafting/specValidators';

/** The review renders per Figure (PRD 0023 D5 guardrail: three rounds per Figure). */
export const MAX_ROUNDS = 3;

/** The citations of the 2D diagram SVG checks (`diagramFaults.ts`), for the receipt rows that pass. */
const DIAGRAM_RULES: Readonly<Record<string, string>> = {
	'us-keywords-only': '37 CFR 1.84(o); MPEP 608.02 (legends with "as few words as possible")',
	'epo-short-sentence': 'GL A-IX 8; OJ EPO 2025 A49 Art. 1(2)(j) (a short sentence per method step)',
	'label-overlap': '37 CFR 1.84(p)(1); PCT Rule 11.13(h) (plain and legible characters)',
	'numeral-set': '37 CFR 1.84(p)(4), (p)(5) (one item, one character; none absent from the description)',
	'lead-line': '37 CFR 1.84(q) (a lead line connects each reference character to its item)',
	'lead-crosses-edge': '37 CFR 1.84(q) (lead lines must not cross each other or other lines)',
};

/** What one CLI run prints and exits with. */
export interface CliResult {
	readonly exitCode: 0 | 1 | 2;
	readonly output: CliOutput;
}

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

/** A Finding as the CLI prints it. */
type CliFinding = {
	readonly severity: string;
	readonly rule: string;
	readonly message: string;
	readonly file?: string;
	readonly citation?: string;
	readonly waived?: string;
};

/** The parsed command line: positional arguments and `--name value` options. */
interface ParsedArgs {
	readonly positional: readonly string[];
	readonly options: ReadonlyMap<string, string>;
}

/** Thrown for a refusal; the message is the reason. */
class Refusal extends Error {
	constructor(reason: string, readonly details: Readonly<Record<string, CliValue>> = {}) {
		super(reason);
	}
}

/** Thrown for a usage error. */
class UsageError extends Error { }

const USAGE = 'Usage: drawings-cli render <matter> <figure> --scene <file> | --flowchart <file> | --block <file>; drawings-cli build <matter>; drawings-cli propose <matter> <numeral> <part> --sketch <file> [--figure <n>] [--features F1,F2]. Options: --root <workspace>, --office US|EPO|PCT.';

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
		...(finding.waived ? { waived: finding.waived.reason } : {}),
	};
}

/** The paths of one matter, absolute, with the drafting folder contract. */
interface Matter {
	readonly root: string;
	readonly folder: DraftingFolder;
	readonly dir: string;
	readonly drawingsDir: string;
	abs(workspacePath: string): string;
}

function resolveMatter(root: string, name: string | undefined): Matter {
	const folder = name === undefined ? undefined : resolveDraftingFolder(name);
	if (!folder) {
		throw new UsageError(`"${name ?? ''}" is not a matter name. Give the folder name under drafting/, e.g. "widget".`);
	}
	const abs = (workspacePath: string) => path.join(root, ...workspacePath.split('/'));
	if (!existsSync(abs(folder.folder))) {
		throw new Refusal(`The matter folder ${folder.folder}/ does not exist under ${root}.`);
	}
	return { root, folder, dir: abs(folder.folder), drawingsDir: abs(folder.drawings), abs };
}

async function readOptional(file: string): Promise<string | undefined> {
	try {
		return await fs.readFile(file, 'utf8');
	} catch {
		return undefined;
	}
}

async function readFigures(matter: Matter): Promise<string> {
	const figures = await readOptional(matter.abs(matter.folder.figures));
	if (figures === undefined) {
		throw new Refusal(`${matter.folder.figures} does not exist. Write the figures list first: a "## FIG. N" heading per Figure and one "- 12: part" line per part.`);
	}
	return figures;
}

/** The office: `feature-list.md` frontmatter first, then `--office`. */
async function readMatterOffice(matter: Matter, option: string | undefined): Promise<DrawingOffice> {
	const featureList = await readOptional(matter.abs(matter.folder.featureList));
	const fromFile = featureList === undefined ? undefined : readOffice(parseDraftingFrontmatter(featureList).fields);
	if (fromFile) {
		return fromFile;
	}
	const upper = option?.trim().toUpperCase();
	if (upper === 'US' || upper === 'EPO' || upper === 'PCT') {
		return upper;
	}
	throw new Refusal(`No office: ${matter.folder.featureList} sets no \`office\` (US or EPO). Set it there, or pass --office US, EPO or PCT.`);
}

/** The drafting office of the figure gates: PCT sheets follow the EPO wording. */
function draftingOffice(office: DrawingOffice): DraftingOffice {
	return office === 'US' ? 'US' : 'EPO';
}

/** `1`, `FIG-1`, `fig. 1A` = `1` / `1A`. */
function parseFigureKey(text: string | undefined): { key: string; number: number; partial?: string } {
	const match = /^(?:fig(?:ure)?[-.\s]*)?(?<number>[1-9]\d*)(?<partial>[A-Za-z])?$/i.exec((text ?? '').trim());
	if (!match?.groups) {
		throw new UsageError(`"${text ?? ''}" is not a Figure. Give its number, e.g. 1, 2A or FIG-1.`);
	}
	const partial = match.groups.partial?.toUpperCase();
	return { key: `${match.groups.number}${partial ?? ''}`, number: Number(match.groups.number), ...(partial ? { partial } : {}) };
}

/** The review rounds already written for a Figure: `review/FIG-<key>.round-<n>.png`. */
async function reviewRounds(drawingsDir: string, key: string): Promise<number[]> {
	const names = await fs.readdir(path.join(drawingsDir, 'review')).catch(() => [] as string[]);
	const pattern = new RegExp(`^FIG-${key}\\.round-(?<round>\\d+)\\.png$`);
	return names.flatMap(name => {
		const round = pattern.exec(name)?.groups?.round;
		return round ? [Number(round)] : [];
	}).sort((a, b) => a - b);
}

/** The numerals of `figures.md` the attorney confirmed (no `(proposed)` marker). */
function confirmedNumerals(figures: string): string[] {
	return [...new Set(parseFigureParts(figures).filter(part => !part.proposed).map(part => part.numeral))];
}

async function readJsonFile(file: string, what: string): Promise<object> {
	const text = await readOptional(file);
	if (text === undefined) {
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

/** The source of a 2D Figure as written to `FIG-N.flowchart.json`. */
interface FlowchartSource {
	readonly claim?: string;
	readonly steps?: readonly DiagramStep[];
	readonly terminals?: boolean;
	readonly proposal?: FlowchartProposal;
}

/** The source of a block diagram as written to `FIG-N.block.json`. */
interface BlockSource {
	readonly blocks: readonly DiagramBlock[];
	readonly connections: readonly DiagramConnection[];
}

function isFlowchartSource(value: object): value is FlowchartSource {
	const source = value as FlowchartSource;
	const steps = source.steps;
	return (typeof source.claim === 'string' || (Array.isArray(steps) && steps.every(step => typeof step?.id === 'string' && typeof step?.text === 'string')))
		&& (source.terminals === undefined || typeof source.terminals === 'boolean')
		&& (source.proposal === undefined || (typeof source.proposal === 'object' && source.proposal !== null));
}

function isBlockSource(value: object): value is BlockSource {
	const source = value as BlockSource;
	return Array.isArray(source.blocks) && source.blocks.every(block => typeof block?.id === 'string' && typeof block?.label === 'string')
		&& Array.isArray(source.connections) && source.connections.every(connection => typeof connection?.from === 'string' && typeof connection?.to === 'string');
}

async function flowchartSteps(source: FlowchartSource): Promise<readonly DiagramStep[]> {
	if (source.steps) {
		return source.steps;
	}
	const { stepsFromMethodClaim } = await import('../../common/diagram/steps');
	return stepsFromMethodClaim(source.claim ?? '');
}

/** The step or block numerals of a 2D Figure, in order. */
async function diagramNumerals(kind: 'flowchart' | 'block', source: FlowchartSource | BlockSource, scheme: DiagramNumeralScheme, figure: number): Promise<number[]> {
	const { numeralFor } = await import('../../common/diagram/diagramText');
	const count = kind === 'flowchart' ? (await flowchartSteps(source as FlowchartSource)).length : (source as BlockSource).blocks.length;
	return Array.from({ length: count }, (_, index) => numeralFor(scheme, figure, index));
}

const SOURCE_SUFFIXES = ['scene.json', 'flowchart.json', 'block.json'] as const;

async function render(args: ParsedArgs, root: string, cwd: string): Promise<CliOutput> {
	const matter = resolveMatter(root, args.positional[1]);
	const figure = parseFigureKey(args.positional[2]);
	const inputs = (['scene', 'flowchart', 'block'] as const).filter(kind => args.options.has(kind));
	if (inputs.length !== 1) {
		throw new UsageError('Give exactly one input: --scene <file>, --flowchart <file> or --block <file>.');
	}
	const kind = inputs[0];
	const figures = await readFigures(matter);
	const numbers = figureNumbers(figures);
	if (!hasFigure(numbers, figure.key) && !hasFigure(numbers, String(figure.number))) {
		throw new Refusal(`FIG. ${figure.key} is not in ${matter.folder.figures} (Figures: ${numbers.join(', ') || 'none'}). Add a "## FIG. ${figure.key}" heading with its parts first.`);
	}
	if (kind !== 'scene' && figure.partial) {
		throw new UsageError(`A ${kind} Figure takes a whole number, not ${figure.key}.`);
	}
	const rounds = await reviewRounds(matter.drawingsDir, figure.key);
	if (rounds.length >= MAX_ROUNDS) {
		throw new Refusal(`FIG. ${figure.key} has used its ${MAX_ROUNDS} review rounds. Report the open Findings to the attorney; the attorney starts new rounds by deleting drawings/review/FIG-${figure.key}.round-*.png.`);
	}
	const round = (rounds.at(-1) ?? 0) + 1;
	const inputFile = path.resolve(cwd, args.options.get(kind)!);
	const input = await readJsonFile(inputFile, kind);
	const settings = readFiguresSettings(figures);
	const confirmed = confirmedNumerals(figures);
	const notes: string[] = [];

	let result: { svg?: string; findings: readonly DraftFinding[] };
	if (kind === 'scene') {
		const sceneFigure = (input as { figure?: string }).figure;
		if (sceneFigure !== `FIG-${figure.key}`) {
			throw new Refusal(`The scene draws "${sceneFigure ?? ''}", not FIG-${figure.key}. Set "figure": "FIG-${figure.key}".`);
		}
		const { renderFigure } = await import('../kernel/figureRenderer');
		result = await renderFigure(input, { allowedNumerals: confirmed });
		const blocking = result.findings.filter(finding => finding.rule === 'part-without-numeral' || finding.rule === 'numeral-not-allowed');
		if (blocking.length > 0) {
			throw new Refusal(`FIG. ${figure.key} has a part without a numeral or a numeral that is not a confirmed part of ${matter.folder.figures}. Nothing was written. A new part goes through "propose" and the attorney's confirmation first.`, { findings: blocking.map(toCliFinding) });
		}
	} else {
		const office = draftingOffice(await readMatterOffice(matter, args.options.get('office')));
		let diagram: DiagramResult;
		if (kind === 'flowchart') {
			if (!isFlowchartSource(input)) {
				throw new Refusal('The flowchart file must be { "claim": "<approved method claim>" } or { "steps": [{ "id": "s1", "text": "..." }] }, with optional "terminals" and "proposal".');
			}
			const { drawFlowchart } = await import('../../common/diagram/flowchart');
			diagram = await drawFlowchart({ office, scheme: settings.numerals, figure: figure.number, steps: await flowchartSteps(input), terminals: input.terminals, proposal: input.proposal });
		} else {
			if (!isBlockSource(input)) {
				throw new Refusal('The block file must be { "blocks": [{ "id": "...", "label": "..." }], "connections": [{ "from": "...", "to": "..." }] }.');
			}
			const { drawBlockDiagram } = await import('../../common/diagram/blockDiagram');
			const blockInput: BlockDiagramInput = { office, scheme: settings.numerals, figure: figure.number, blocks: input.blocks, connections: input.connections };
			diagram = await drawBlockDiagram(blockInput);
		}
		result = { svg: diagram.svg, findings: diagram.findings };
		if (diagram.svg) {
			const missing = (await diagramNumerals(kind, input as FlowchartSource | BlockSource, settings.numerals, figure.number)).map(String).filter(numeral => !confirmed.includes(numeral));
			if (missing.length) {
				notes.push(`The numerals ${missing.join(', ')} of FIG. ${figure.key} are not in ${DRAFTING_FILE_NAMES.figures}. Add them under "## FIG. ${figure.key}" so the description names them.`);
			}
		}
	}
	if (!result.svg) {
		throw new Refusal(`FIG. ${figure.key} was not drawn. Fix the Findings and render again; no round was used.`, { findings: result.findings.map(toCliFinding) });
	}

	const { writeReviewPng, figureReviewPath } = await import('../raster/rasterize');
	await fs.mkdir(matter.drawingsDir, { recursive: true });
	const base = `FIG-${figure.key}`;
	const sourceSuffix = kind === 'scene' ? 'scene.json' : `${kind}.json`;
	for (const suffix of SOURCE_SUFFIXES.filter(item => item !== sourceSuffix)) {
		await fs.rm(path.join(matter.drawingsDir, `${base}.${suffix}`), { force: true });
	}
	await fs.writeFile(path.join(matter.drawingsDir, `${base}.${sourceSuffix}`), `${JSON.stringify(input, undefined, '\t')}\n`);
	await fs.writeFile(path.join(matter.drawingsDir, `${base}.svg`), result.svg);
	const reviewPath = figureReviewPath(figure.key, round);
	await writeReviewPng(matter.drawingsDir, reviewPath, result.svg);
	const drawings = matter.folder.drawings;
	return {
		ok: true,
		command: 'render',
		figure: `FIG. ${figure.key}`,
		round,
		roundsLeft: MAX_ROUNDS - round,
		files: [`${drawings}/${base}.${sourceSuffix}`, `${drawings}/${base}.svg`, `${drawings}/${reviewPath}`],
		review: `${drawings}/${reviewPath}`,
		errors: result.findings.filter(finding => finding.severity === 'Error').length,
		findings: result.findings.map(toCliFinding),
		notes,
	};
}

/** One Figure found in `drawings/`, with its source kind. */
interface DrawnFigure {
	readonly key: string;
	readonly number: number;
	readonly partial?: string;
	readonly svg: string;
	readonly kind: 'scene' | 'flowchart' | 'block' | 'svg';
	readonly source?: object;
}

async function readDrawnFigures(drawingsDir: string): Promise<DrawnFigure[]> {
	const names = await fs.readdir(drawingsDir).catch(() => [] as string[]);
	const result: DrawnFigure[] = [];
	for (const name of names) {
		const match = /^FIG-(?<number>[1-9]\d*)(?<partial>[A-Z])?\.svg$/.exec(name);
		if (!match?.groups) {
			continue;
		}
		const key = `${match.groups.number}${match.groups.partial ?? ''}`;
		const svg = await fs.readFile(path.join(drawingsDir, name), 'utf8');
		let kind: DrawnFigure['kind'] = 'svg';
		let source: object | undefined;
		for (const candidate of ['scene', 'flowchart', 'block'] as const) {
			const file = path.join(drawingsDir, `FIG-${key}.${candidate === 'scene' ? 'scene' : candidate}.json`);
			if (existsSync(file)) {
				kind = candidate;
				source = await readJsonFile(file, candidate);
				break;
			}
		}
		result.push({ key, number: Number(match.groups.number), ...(match.groups.partial ? { partial: match.groups.partial } : {}), svg, kind, ...(source ? { source } : {}) });
	}
	return result.sort((a, b) => a.number - b.number || (a.partial ?? '').localeCompare(b.partial ?? ''));
}

/** The Figure-level checks again, on the written files, before the sheets are made. */
async function checkDrawnFigure(figure: DrawnFigure, office: DrawingOffice, scheme: DiagramNumeralScheme, confirmed: readonly string[]): Promise<readonly (DraftFinding & { readonly citation?: string })[]> {
	const file = `FIG-${figure.key}.svg`;
	if (figure.kind === 'scene' && figure.source) {
		const validation = validateScene(figure.source);
		const sceneFindings = validation.scene ? checkSceneFaults(validation.scene, confirmed) : validation.findings;
		return [...sceneFindings, ...checkFigureSvgFaults(figure.svg, { file })];
	}
	if ((figure.kind === 'flowchart' || figure.kind === 'block') && figure.source) {
		const { checkDiagramSvg } = await import('../../common/diagram/diagramFaults');
		const numerals = await diagramNumerals(figure.kind, figure.source as FlowchartSource | BlockSource, scheme, figure.number);
		return checkDiagramSvg(figure.svg, { office: draftingOffice(office) === 'US' ? 'US' : 'EPO', figure: figure.number, numerals });
	}
	return checkFigureSvgFaults(figure.svg, { file });
}

/** The identity of a Figure Finding against a waiver in `findings.md`: rule and message. */
function waiverKey(finding: DraftFinding): string {
	return `${finding.rule}|${finding.message.replace(/\s+/g, ' ').trim()}`;
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

async function build(args: ParsedArgs, root: string): Promise<CliOutput> {
	const matter = resolveMatter(root, args.positional[1]);
	const figures = await readFigures(matter);
	const office = await readMatterOffice(matter, args.options.get('office'));
	const settings = readFiguresSettings(figures);
	const notes: string[] = [];

	const gate = [...checkFigureProposals(figures), ...checkFiguresSettings(figures, draftingOffice(office))].filter(finding => finding.severity === 'Error');
	if (gate.length) {
		throw new Refusal(`${matter.folder.figures} blocks the Drawing Set. The attorney confirms or removes each proposal and fixes the settings.`, { findings: gate.map(toCliFinding) });
	}
	const featureList = await readOptional(matter.abs(matter.folder.featureList));
	const outline = await readOptional(matter.abs(matter.folder.draftOutline));
	if (featureList !== undefined && outline !== undefined) {
		const coverage = checkClaimedFeatureCoverage({ office: draftingOffice(office), figures, outline: parseDraftOutline(outline), featureList });
		const gaps = coverage.filter(finding => finding.severity === 'Error');
		if (gaps.length) {
			throw new Refusal('A claimed feature has no drawn part (coverage gap). Draw a confirmed part that links the Feature List row, or ask the attorney.', { findings: gaps.map(toCliFinding) });
		}
		notes.push(...coverage.map(finding => finding.message));
	} else {
		notes.push(`The claimed-feature coverage was not checked: ${matter.folder.featureList} or ${matter.folder.draftOutline} does not exist.`);
	}

	const drawn = await readDrawnFigures(matter.drawingsDir);
	if (drawn.length === 0) {
		throw new Refusal(`${matter.folder.drawings}/ has no FIG-N.svg. Render each Figure first.`);
	}
	const confirmed = confirmedNumerals(figures);
	const figureFindings: (DraftFinding & { readonly citation?: string })[] = [];
	const waived = new Map<string, DraftFinding['waived']>();
	const findingsText = await readOptional(matter.abs(matter.folder.findings));
	for (const finding of findingsText === undefined ? [] : parseFindingsFile(findingsText)) {
		if (finding.waived) {
			waived.set(waiverKey(finding), finding.waived);
		}
	}
	for (const figure of drawn) {
		for (const finding of await checkDrawnFigure(figure, office, settings.numerals, confirmed)) {
			const waiver = waived.get(waiverKey(finding));
			figureFindings.push(waiver ? { ...finding, waived: waiver } : finding);
		}
	}
	const open = figureFindings.filter(finding => finding.severity === 'Error' && !finding.waived);
	if (open.length) {
		throw new Refusal(`${open.length} Figure Error(s) are open. Fix each Figure and render again, or the attorney waives the Finding in ${matter.folder.findings} with a "  - Waived: <reason>" line.`, { findings: open.map(toCliFinding) });
	}

	const { layoutDrawingSheets } = await import('../../common/sheets/sheetLayout');
	const figureInputs: FigureInput[] = drawn.map(figure => ({ number: figure.number, ...(figure.partial ? { partial: figure.partial } : {}), svg: figure.svg }));
	const layout = layoutDrawingSheets(office, settings.pageSize, figureInputs);
	if (!layout.ok) {
		throw new Refusal(`The Drawing Sheets cannot be laid out: ${layout.reason}`);
	}
	const sheets = layout.sheets.map(sheet => sheet.svg);
	for (const name of await fs.readdir(matter.drawingsDir)) {
		if (isDrawingSheetFile(name)) {
			await fs.rm(path.join(matter.drawingsDir, name));
		}
	}
	const sheetFiles = sheets.map((_, index) => `sheet-${index + 1}.svg`);
	await Promise.all(sheets.map((svg, index) => fs.writeFile(path.join(matter.drawingsDir, sheetFiles[index]), svg)));
	const { writeDrawingsPdf } = await import('../pdf/drawingsPdf');
	const pdf = await writeDrawingsPdf(matter.drawingsDir, sheets, { title: `Drawings - ${matter.folder.matter}` });

	const reviewRecords: FigureReviewRecord[] = [];
	for (const figure of drawn) {
		const rounds = await reviewRounds(matter.drawingsDir, figure.key);
		reviewRecords.push({ figure: figure.key, rounds: rounds.map(round => ({ round, png: `review/FIG-${figure.key}.round-${round}.png` })) });
	}
	const figureRules: Record<string, string> = {
		...(drawn.some(figure => figure.kind !== 'flowchart' && figure.kind !== 'block') ? DRAWING_RULES : {}),
		...(drawn.some(figure => figure.kind === 'flowchart' || figure.kind === 'block') ? DIAGRAM_RULES : {}),
	};
	const { writeDrawingsReceipt } = await import('../../common/sheets/receipt');
	const receipt = writeDrawingsReceipt({ office, pageSize: settings.pageSize, sheets, figureRules, figureFindings, reviewRounds: reviewRecords, pdf, date: today() });
	await fs.writeFile(path.join(matter.drawingsDir, 'drawings-compliance.md'), receipt.markdown);

	const drawings = matter.folder.drawings;
	const files = [...sheetFiles.map(name => `${drawings}/${name}`), `${drawings}/drawings.pdf`, `${drawings}/drawings-compliance.md`];
	const draft = await readOptional(matter.abs(matter.folder.draft));
	const claims = await readOptional(matter.abs(matter.folder.claims));
	if (draft !== undefined && claims !== undefined) {
		const manifest = filingManifest({ office: draftingOffice(office), draft, claims, figures, drawingFiles: sheetFiles });
		await fs.writeFile(matter.abs(matter.folder.filingManifest), renderFilingManifest(manifest, matter.folder));
		files.push(matter.folder.filingManifest);
	} else {
		notes.push(`${matter.folder.filingManifest} was not written: ${matter.folder.draft} or ${matter.folder.claims} does not exist. The export writes it.`);
	}
	const count = (result: string) => receipt.checks.filter(check => check.result === result).length;
	return {
		ok: true,
		command: 'build',
		office,
		pageSize: settings.pageSize,
		figures: drawn.map(figure => `FIG. ${figure.key}`),
		sheets: sheets.length,
		files,
		receipt: {
			file: `${drawings}/drawings-compliance.md`,
			pass: count('pass'),
			fail: count('fail'),
			notChecked: count('not-checked'),
			failing: receipt.checks.filter(check => check.result === 'fail').map(check => `${check.id}: ${check.detail}`),
		},
		notes,
	};
}

async function propose(args: ParsedArgs, root: string, cwd: string): Promise<CliOutput> {
	const matter = resolveMatter(root, args.positional[1]);
	const numeral = args.positional[2];
	const part = args.positional.slice(3).join(' ').trim();
	if (!numeral || !/^\d{1,4}[a-z]?$/.test(numeral) || !part) {
		throw new UsageError('Give a numeral and a part name: propose <matter> <numeral> <part> --sketch <file>.');
	}
	const sketchOption = args.options.get('sketch');
	if (!sketchOption) {
		throw new UsageError('Give the sketch the part comes from: --sketch <file>.');
	}
	const figures = await readFigures(matter);
	const existing = parseFigureParts(figures).find(item => item.numeral === numeral);
	if (existing) {
		throw new Refusal(`Numeral ${numeral} is already "${existing.part}" in ${matter.folder.figures} (line ${existing.line}). Give the new part another numeral.`);
	}
	const candidates = [path.resolve(matter.dir, sketchOption), path.resolve(root, sketchOption), path.resolve(cwd, sketchOption)];
	const sketch = candidates.find(candidate => existsSync(candidate));
	if (!sketch) {
		throw new Refusal(`The sketch ${sketchOption} does not exist in ${matter.folder.folder}/ or the workspace. Copy it to ${matter.folder.folder}/sketches/ first.`);
	}
	const relative = path.relative(matter.dir, sketch).split(path.sep).join('/');
	const source = relative.startsWith('..') ? path.relative(root, sketch).split(path.sep).join('/') : relative;
	const features = args.options.get('features')?.split(',').map(item => item.trim()).filter(Boolean);
	const line = formatFigurePart({ numeral, part, ...(features?.length ? { features } : {}), proposed: { source } });

	const lines = figures.replace(/\r\n/g, '\n').split('\n');
	const figureOption = args.options.get('figure');
	let insertAt = lines.length;
	if (figureOption) {
		const wanted = parseFigureKey(figureOption).key;
		const section = parseFigureSections(figures).figures.find(item => hasFigure(figureHeadingNumbers(item.label), wanted));
		if (!section) {
			throw new Refusal(`FIG. ${wanted} is not a heading of ${matter.folder.figures}.`);
		}
		const last = section.parts.at(-1)?.line ?? section.line;
		insertAt = last;
	} else {
		while (insertAt > 0 && lines[insertAt - 1].trim() === '') {
			insertAt--;
		}
	}
	lines.splice(insertAt, 0, line);
	const text = lines.join('\n');
	await fs.writeFile(matter.abs(matter.folder.figures), text.endsWith('\n') ? text : `${text}\n`);
	return {
		ok: true,
		command: 'propose',
		file: matter.folder.figures,
		line: insertAt + 1,
		added: line,
		next: 'Stop. The attorney confirms the part by removing "(proposed)", or deletes the line. Do not draw the part before that.',
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
			case 'propose': return { exitCode: 0, output: await propose(args, root, cwd) };
			default: throw new UsageError(USAGE);
		}
	} catch (error) {
		if (error instanceof Refusal) {
			return { exitCode: 1, output: { ok: false, command, reason: error.message, ...error.details } };
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
