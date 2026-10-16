/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseClaims } from '../../../tools/common/drafting/claims';
import { readFiguresSettings } from '../../../tools/common/drafting/figures';
import { DraftFinding } from '../../../tools/common/drafting/finding';
import { DRAFTING_FILE_NAMES } from '../../../tools/common/drafting/folderContract';
import { figureHeadingNumbers, hasFigure, parseFigureParts, parseFigureSections } from '../../../tools/common/drafting/specValidators';
import type { DiagramBlock, DiagramConnection } from '../../common/diagram/blockDiagram';
import type { DiagramResult } from '../../common/diagram/diagram';
import type { FlowchartProposal } from '../../common/diagram/flowchart';
import type { DiagramStep } from '../../common/diagram/steps';
import { checkFigureSvgFaults, checkSceneFaults, DRAWING_RULES, DrawingFinding } from '../../common/scene/drawingFaults';
import type { DrawingScene } from '../../common/scene/drawingScene';
import { validateScene } from '../../common/scene/sceneValidator';
import { DIAGRAM_SVG_CHECKS, DiagramSource, drawingFindingLine, FigureId, figureId, figureListText, figureOfSvgFile, figureSetStatus, MAX_REVIEW_CYCLES, MAX_REVIEW_ROUNDS, parseReviewRounds, partsOfFigure, renderReviewRounds, ReviewRound, ReviewRounds, reviewPngName, reviewPngs, reviewState, ROUNDS_FILE } from '../../common/drawingFiles';
import { ApprovedClaims, MatterFiles, readApprovedClaims, readMatterOffice } from './matterFiles';

/** A flowchart Figure: the steps in order, or the approved method claim to read them from. */
export interface FlowchartRequest {
	/** The method steps in order; step ids are `s1`, `s2`, ... */
	readonly steps?: readonly string[];
	/** The number of an approved method claim in `claims.md`; its steps become the boxes. */
	readonly fromClaim?: number;
	/** Draws START and END terminals. */
	readonly terminals?: boolean;
	/** Decision nodes and extra edges (branches, loops); never a step. */
	readonly proposal?: FlowchartProposal;
}

/** A block-diagram Figure. */
export interface BlockRequest {
	readonly blocks: readonly DiagramBlock[];
	readonly connections?: readonly DiagramConnection[];
}

/** What to render: the Figure and exactly one of `scene`, `flowchart` and `block`. */
export interface RenderFigureInput {
	readonly figure: number;
	/** The capital letter of a partial view, e.g. `A` for FIG. 1A. */
	readonly partial?: string;
	readonly scene?: DrawingScene;
	readonly flowchart?: FlowchartRequest;
	readonly block?: BlockRequest;
	/** True when the caller shows the review render to the model; recorded per round. */
	readonly seen: boolean;
	/**
	 * Closes the current review cycle and renders round 1 of the next (#696). Only when the attorney
	 * asked for more work on the Figure: the editor tool asks the attorney to confirm first.
	 */
	readonly newCycle?: boolean;
}

/** Hooks of the caller. */
export interface RenderFigureOptions {
	/** The Approved Claims for `flowchart.fromClaim`; {@link readApprovedClaims} by default. */
	readonly approvedClaims?: () => Promise<ApprovedClaims>;
}

/** The result of a render: the written Figure, or the refusal reason (nothing was written). */
export type RenderFigureResult =
	| {
		readonly ok: true;
		/** The result text for the model. */
		readonly text: string;
		/** The review render of this round. */
		readonly png: Uint8Array;
		readonly seen: boolean;
		/** The review cycle of this round, from 1. */
		readonly cycle: number;
		readonly round: number;
		/** The review render of this round, relative to the matter folder. */
		readonly review: string;
		readonly findings: readonly DraftFinding[];
	}
	| { readonly ok: false; readonly reason: string };

/** What one render produced, before anything is written. */
interface RenderedSource {
	readonly svg: string;
	readonly source: string;
	readonly findings: readonly DraftFinding[];
}

/**
 * Renders one Figure of a drafting matter (PRD 0023, slice D5) from a 3D scene, a flowchart or a
 * block diagram. It checks the input against `figures.md` first and refuses with the reason, and
 * writes nothing, when the figure list has no heading for the Figure, a part has no numeral or a
 * numeral is not in the figure list (for a 2D Figure: not under its heading), on a fourth round
 * in a review cycle, and after {@link MAX_REVIEW_CYCLES} cycles (see {@link reviewCycleRefusal}). Then it renders (the kernel and the layout engine load on the first call), runs the
 * mechanical fault list, and writes `drawings/FIG-N.scene.json`, `drawings/FIG-N.svg`, the review
 * render `drawings/review/FIG-N.round-R.png` and the round in `drawings/rounds.json`. No model call.
 */
export async function renderFigureOp(files: MatterFiles, input: RenderFigureInput, options: RenderFigureOptions = {}): Promise<RenderFigureResult> {
	const refuse = (reason: string): RenderFigureResult => ({ ok: false, reason });
	const drawings = `${files.folder}/drawings`;
	const figuresPath = `${files.folder}/${DRAFTING_FILE_NAMES.figures}`;
	const figure = figureId(input.figure, input.partial);
	if (typeof figure === 'string') {
		return refuse(figure);
	}
	const modes = [input.scene, input.flowchart, input.block].filter(mode => mode !== undefined).length;
	if (modes !== 1) {
		return refuse('Give exactly one of `scene` (a 3D Figure), `flowchart` or `block`.');
	}
	const figures = await files.read(DRAFTING_FILE_NAMES.figures);
	if (figures === undefined) {
		return refuse(`${figuresPath} does not exist. Every numeral in a Figure is a numeral of the figure list, so write the figure list first.`);
	}
	const label = `FIG. ${figure.key}`;
	const sectionNumbers = parseFigureSections(figures).figures.flatMap(section => figureHeadingNumbers(section.label));
	if (!hasFigure(sectionNumbers, figure.key) && !hasFigure(sectionNumbers, String(figure.number))) {
		return refuse(`${figuresPath} has no heading for ${label} (\`## ${label}\` with its parts). Add the Figure and its parts to the figure list first.`);
	}

	const { rounds, state } = await readReviewState(files, figure);
	const blocked = reviewCycleRefusal(files.folder, figure, state, input.newCycle === true);
	if (blocked) {
		return refuse(blocked);
	}
	const startsCycle = input.newCycle === true && state.used > 0;
	const cycle = startsCycle ? state.cycle + 1 : state.cycle;

	const rendered = input.scene
		? await renderScene(input.scene, figure, figures)
		: await renderDiagram(files, input, figure, figures, options.approvedClaims ?? (() => readApprovedClaims(files)));
	if (typeof rendered === 'string') {
		return refuse(rendered);
	}

	const round = startsCycle ? 1 : state.used + 1;
	const png = reviewPngName(figure, cycle, round);
	const { rasterizeSvg } = await import('../raster/rasterize');
	const image = await rasterizeSvg(rendered.svg);
	await files.write(`drawings/FIG-${figure.key}.scene.json`, rendered.source);
	await files.write(`drawings/FIG-${figure.key}.svg`, rendered.svg);
	await files.write(`drawings/${png}`, image.png);
	const record: ReviewRound = { round, png, seen: input.seen };
	const earlier = rounds[figure.key]?.cycle === cycle ? rounds[figure.key].rounds : [];
	await files.write(`drawings/${ROUNDS_FILE}`, renderReviewRounds({ ...rounds, [figure.key]: { cycle, rounds: [...earlier, record] } }));

	const drawn = (await files.listFiles('drawings')).map(name => figureOfSvgFile(name)).filter((item): item is FigureId => item !== undefined);
	const { expected, missing } = figureSetStatus(figures, drawn);
	const errors = rendered.findings.filter(finding => finding.severity === 'Error');
	const text = [
		`Rendered ${label}: wrote ${drawings}/FIG-${figure.key}.scene.json, ${drawings}/FIG-${figure.key}.svg and the review render ${drawings}/${png}. Round ${round} of ${MAX_REVIEW_ROUNDS} in review cycle ${cycle}.`,
		missing.length ? `Still to draw: ${figureListText(missing)} (${figuresPath} names ${expected.length} Figure(s)); build_drawing_set refuses until every one is drawn.` : `Every Figure ${figuresPath} names is drawn.`,
		input.seen ? 'The review render of this round is attached; it is not a deliverable.' : 'No render is attached (the model reads the findings only); the receipt records that no render was seen in this round.',
		rendered.findings.length
			? `Findings (${errors.length} Error(s)):\n${rendered.findings.map(drawingFindingLine).join('\n')}`
			: 'The mechanical fault list found nothing. The attorney still reviews the Figure.',
		errors.length
			? `Fix the Errors in the source and render again${round < MAX_REVIEW_ROUNDS ? '' : '; this was the last round of this review cycle, so report the open Errors to the attorney'}. build_drawing_set refuses while an Error is open and not waived.`
			: 'Do not call the Figure compliant or ready to file.',
	].join('\n');
	return { ok: true, text, png: image.png, seen: input.seen, cycle, round, review: `${drawings}/${png}`, findings: rendered.findings };
}

/** The recorded rounds of the matter, and the current review cycle of the Figure with the rounds used in it. */
export async function readReviewState(files: MatterFiles, figure: FigureId): Promise<{ readonly rounds: ReviewRounds; readonly state: { readonly cycle: number; readonly used: number } }> {
	const rounds = parseReviewRounds(await files.read(`drawings/${ROUNDS_FILE}`));
	return { rounds, state: reviewState(rounds, await files.listFiles('drawings/review'), figure) };
}

/**
 * The refusal of the review-round guard (#696), or `undefined` when a round is free. Three rounds
 * per cycle; `newCycle` starts the next cycle; after {@link MAX_REVIEW_CYCLES} cycles only a person
 * clears the rounds with the CLI command `reset-rounds`. `newCycle` on a cycle with no round yet
 * renders round 1 of that cycle.
 */
export function reviewCycleRefusal(folder: string, figure: FigureId, state: { readonly cycle: number; readonly used: number }, newCycle: boolean): string | undefined {
	const label = `FIG. ${figure.key}`;
	const wantsNext = newCycle && state.used > 0;
	if (state.cycle >= MAX_REVIEW_CYCLES && (wantsNext || state.used >= MAX_REVIEW_ROUNDS)) {
		const matter = folder.split('/').pop() ?? folder;
		return `${label} used ${MAX_REVIEW_CYCLES} review cycles; a person must clear it: drawings reset-rounds ${matter} ${figure.key}`;
	}
	if (!wantsNext && state.used >= MAX_REVIEW_ROUNDS) {
		return `Three review rounds used for ${label} in cycle ${state.cycle}. Start a new cycle only when the attorney asked for more work on this Figure (newCycle).`;
	}
	return undefined;
}

/** What `reset-rounds` cleared for one Figure. */
export interface ResetReviewRoundsResult {
	/** The review cycle the Figure was in; 0 when it had no record. */
	readonly cycle: number;
	/** The rounds recorded in that cycle. */
	readonly rounds: number;
	/** The review renders deleted, relative to the matter folder. */
	readonly deleted: readonly string[];
}

/**
 * Clears the review rounds of one Figure (#696): deletes its entry in `rounds.json` and its review
 * renders, so the Figure starts again at cycle 1, round 1. A human step only: the CLI command
 * `reset-rounds` calls it, no editor tool does, and the skill does not name it.
 */
export async function resetReviewRoundsOp(files: MatterFiles, figure: FigureId): Promise<ResetReviewRoundsResult> {
	const { rounds, state } = await readReviewState(files, figure);
	const entry = rounds[figure.key];
	const pngs = reviewPngs(await files.listFiles('drawings/review'), figure);
	for (const png of pngs) {
		await files.delete(`drawings/review/${png.name}`);
	}
	if (entry) {
		const rest = Object.fromEntries(Object.entries(rounds).filter(([key]) => key !== figure.key));
		await files.write(`drawings/${ROUNDS_FILE}`, renderReviewRounds(rest));
	}
	return {
		cycle: entry || pngs.length ? state.cycle : 0,
		rounds: state.used,
		deleted: pngs.map(png => `${files.folder}/drawings/review/${png.name}`),
	};
}

/** Checks the scene against the figure list, then renders it on the kernel. */
async function renderScene(input: DrawingScene, figure: FigureId, figures: string): Promise<RenderedSource | string> {
	const allowedNumerals = [...new Set(parseFigureParts(figures).map(part => part.numeral))];
	const validation = validateScene({ ...input, figure: `FIG-${figure.key}` });
	if (!validation.scene) {
		return `The scene does not follow the schema:\n${validation.findings.map(drawingFindingLine).join('\n')}`;
	}
	const scene = validation.scene;
	const gate = checkSceneFaults(scene, allowedNumerals).filter(finding => finding.rule === 'part-without-numeral' || finding.rule === 'numeral-not-allowed');
	if (gate.length) {
		return `Every part drawn has a numeral, and every numeral is in the figure list:\n${gate.map(drawingFindingLine).join('\n')}\nAdd the part to the figure list (propose_figure_part when the disclosure does not state it), or remove it from the scene.`;
	}
	const { renderFigure } = await import('../kernel/figureRenderer');
	const result = await renderFigure(scene, { allowedNumerals });
	if (!result.svg) {
		return `The scene could not be rendered:\n${result.findings.map(drawingFindingLine).join('\n')}`;
	}
	return { svg: result.svg, source: `${JSON.stringify(scene, null, '\t')}\n`, findings: [...validation.findings, ...result.findings] };
}

/** Builds the diagram input from the matter, checks its numerals against the figure list, then draws it. */
async function renderDiagram(files: MatterFiles, input: RenderFigureInput, figure: FigureId, figures: string, approvedClaims: () => Promise<ApprovedClaims>): Promise<RenderedSource | string> {
	const office = await readMatterOffice(files);
	if (!office) {
		return `Neither ${files.folder}/${DRAFTING_FILE_NAMES.draft} nor ${files.folder}/${DRAFTING_FILE_NAMES.featureList} names the office (\`office: US\` or \`office: EPO\`); a 2D Figure follows the office text rules.`;
	}
	const scheme = readFiguresSettings(figures).numerals;
	const fig = `FIG-${figure.key}`;
	let source: DiagramSource;
	let labels: string[];
	if (input.flowchart) {
		const steps = await flowchartSteps(files, input.flowchart, approvedClaims);
		if (typeof steps === 'string') {
			return steps;
		}
		source = { figure: fig, mode: 'flowchart', input: { office, scheme, figure: figure.number, steps, terminals: input.flowchart.terminals, proposal: input.flowchart.proposal } };
		labels = steps.map(step => step.text);
	} else {
		const blocks = input.block?.blocks ?? [];
		source = { figure: fig, mode: 'block', input: { office, scheme, figure: figure.number, blocks, connections: input.block?.connections ?? [] } };
		labels = blocks.map(block => block.label);
	}

	const { numeralFor } = await import('../../common/diagram/diagramText');
	const listed = new Set(partsOfFigure(figures, figure).map(part => part.numeral));
	const missing = labels.map((text, index) => ({ numeral: String(numeralFor(scheme, figure.number, index)), text })).filter(item => !listed.has(item.numeral));
	if (missing.length) {
		return `Every numeral in a Figure is a numeral of the figure list (${DRAWING_RULES['numeral-not-allowed']}). The ${source.mode === 'flowchart' ? 'steps' : 'blocks'} of FIG. ${figure.key} take these numerals (\`numerals: ${scheme}\`), which are not under its heading in ${files.folder}/${DRAFTING_FILE_NAMES.figures}:\n${missing.map(item => `- ${item.numeral}: ${item.text}`).join('\n')}\nAdd these lines under the FIG. ${figure.key} heading, then render again.`;
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
		return `The diagram was refused:\n${result.findings.map(drawingFindingLine).join('\n')}`;
	}
	const svgFindings: DrawingFinding[] = checkFigureSvgFaults(result.svg, { file: `${fig}.svg`, checks: DIAGRAM_SVG_CHECKS });
	return { svg: result.svg, source: `${JSON.stringify(source, null, '\t')}\n`, findings: [...result.findings, ...svgFindings] };
}

/** The steps given in order, or the steps of the approved method claim. */
async function flowchartSteps(files: MatterFiles, flowchart: FlowchartRequest, approvedClaims: () => Promise<ApprovedClaims>): Promise<DiagramStep[] | string> {
	if (flowchart.fromClaim === undefined) {
		const steps = (flowchart.steps ?? []).map(text => text.trim()).filter(Boolean);
		return steps.length ? steps.map((text, index) => ({ id: `s${index + 1}`, text })) : 'Give the method steps in `flowchart.steps`, or the number of an approved method claim in `flowchart.fromClaim`.';
	}
	if (flowchart.steps?.length) {
		return 'Give either `flowchart.steps` or `flowchart.fromClaim`, not both: the claim is the authority for the steps.';
	}
	const approval = await approvedClaims();
	if (typeof approval === 'string') {
		return `A flowchart from a claim needs the Approved Claims. ${approval}`;
	}
	const claim = parseClaims(approval.text).find(item => item.number === flowchart.fromClaim);
	if (!claim) {
		return `${files.folder}/${DRAFTING_FILE_NAMES.claims} has no claim ${flowchart.fromClaim}.`;
	}
	const { stepsFromMethodClaim } = await import('../../common/diagram/steps');
	const steps = stepsFromMethodClaim(claim.text);
	return steps.length ? steps : `Claim ${claim.number} has no steps to read (a method claim lists its steps after "comprising:").`;
}
