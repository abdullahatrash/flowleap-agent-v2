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
import { DIAGRAM_SVG_CHECKS, DiagramSource, drawingFindingLine, FigureId, figureId, figureListText, figureOfSvgFile, figureSetStatus, MAX_REVIEW_ROUNDS, parseReviewRounds, partsOfFigure, renderReviewRounds, ReviewRound, reviewPngCount, ROUNDS_FILE } from '../../common/drawingFiles';
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
		readonly round: number;
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
 * numeral is not in the figure list (for a 2D Figure: not under its heading), and on a fourth
 * round. Then it renders (the kernel and the layout engine load on the first call), runs the
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

	const rounds = parseReviewRounds(await files.read(`drawings/${ROUNDS_FILE}`));
	const done = Math.max(reviewPngCount(await files.listFiles('drawings/review'), figure), rounds[figure.key]?.length ?? 0);
	if (done >= MAX_REVIEW_ROUNDS) {
		return refuse(`${label} already had ${done} review rounds; the limit is ${MAX_REVIEW_ROUNDS} per Figure. Edit ${drawings}/FIG-${figure.key}.scene.json by hand, or ask the attorney.`);
	}

	const rendered = input.scene
		? await renderScene(input.scene, figure, figures)
		: await renderDiagram(files, input, figure, figures, options.approvedClaims ?? (() => readApprovedClaims(files)));
	if (typeof rendered === 'string') {
		return refuse(rendered);
	}

	const round = done + 1;
	const png = `review/FIG-${figure.key}.round-${round}.png`;
	const { rasterizeSvg } = await import('../raster/rasterize');
	const image = await rasterizeSvg(rendered.svg);
	await files.write(`drawings/FIG-${figure.key}.scene.json`, rendered.source);
	await files.write(`drawings/FIG-${figure.key}.svg`, rendered.svg);
	await files.write(`drawings/${png}`, image.png);
	const record: ReviewRound = { round, png, seen: input.seen };
	await files.write(`drawings/${ROUNDS_FILE}`, renderReviewRounds({ ...rounds, [figure.key]: [...(rounds[figure.key] ?? []), record] }));

	const drawn = (await files.listFiles('drawings')).map(name => figureOfSvgFile(name)).filter((item): item is FigureId => item !== undefined);
	const { expected, missing } = figureSetStatus(figures, drawn);
	const errors = rendered.findings.filter(finding => finding.severity === 'Error');
	const text = [
		`Rendered ${label}: wrote ${drawings}/FIG-${figure.key}.scene.json, ${drawings}/FIG-${figure.key}.svg and the review render ${drawings}/${png}. Round ${round} of ${MAX_REVIEW_ROUNDS}.`,
		missing.length ? `Still to draw: ${figureListText(missing)} (${figuresPath} names ${expected.length} Figure(s)); build_drawing_set refuses until every one is drawn.` : `Every Figure ${figuresPath} names is drawn.`,
		input.seen ? 'The review render of this round is attached; it is not a deliverable.' : 'No render is attached (the model reads the findings only); the receipt records that no render was seen in this round.',
		rendered.findings.length
			? `Findings (${errors.length} Error(s)):\n${rendered.findings.map(drawingFindingLine).join('\n')}`
			: 'The mechanical fault list found nothing. The attorney still reviews the Figure.',
		errors.length
			? `Fix the Errors in the source and render again${round < MAX_REVIEW_ROUNDS ? '' : '; this was the last round, so edit the scene file by hand or ask the attorney'}. build_drawing_set refuses while an Error is open and not waived.`
			: 'Do not call the Figure compliant or ready to file.',
	].join('\n');
	return { ok: true, text, png: image.png, seen: input.seen, round, findings: rendered.findings };
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
