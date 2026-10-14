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
import { LanguageModelDataPart, LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import type { DiagramBlock, DiagramConnection } from '../../drawings/common/diagram/blockDiagram';
import type { DiagramResult } from '../../drawings/common/diagram/diagram';
import type { FlowchartProposal } from '../../drawings/common/diagram/flowchart';
import type { DiagramStep } from '../../drawings/common/diagram/steps';
import { checkFigureSvgFaults, checkSceneFaults, DRAWING_RULES, DrawingFinding } from '../../drawings/common/scene/drawingFaults';
import type { DrawingScene } from '../../drawings/common/scene/drawingScene';
import { validateScene } from '../../drawings/common/scene/sceneValidator';
import { parseClaims } from '../common/drafting/claims';
import { readFiguresSettings } from '../common/drafting/figures';
import { DraftFinding } from '../common/drafting/finding';
import { figureHeadingNumbers, hasFigure, parseFigureParts, parseFigureSections } from '../common/drafting/specValidators';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { DIAGRAM_SVG_CHECKS, DiagramSource, drawingFindingLine, FigureId, figureId, MAX_REVIEW_ROUNDS, parseReviewRounds, partsOfFigure, renderReviewRounds, reviewPngCount, ReviewRound, ROUNDS_FILE } from '../../drawings/common/drawingFiles';
import { DraftingWorkspace, textResult } from './draftingWorkspace';

/** A flowchart Figure: the steps in order, or the approved method claim to read them from. */
interface IFlowchartParams {
	/** The method steps in order; step ids are `s1`, `s2`, ... */
	steps?: string[];
	/** The number of an approved method claim in claims.md; its steps become the boxes. */
	fromClaim?: number;
	/** Draws START and END terminals. */
	terminals?: boolean;
	/** Decision nodes and extra edges (branches, loops); never a step. */
	proposal?: FlowchartProposal;
}

/** A block-diagram Figure. */
interface IBlockParams {
	blocks: DiagramBlock[];
	connections?: DiagramConnection[];
}

interface IRenderFigureParams {
	/** The matter folder name under `drafting/`. */
	matter: string;
	/** The figure number. */
	figure: number;
	/** The capital letter of a partial view, e.g. `A` for FIG. 1A. */
	partial?: string;
	/** The 3D scene of the Figure (ADR 0014 decision 1). */
	scene?: DrawingScene;
	flowchart?: IFlowchartParams;
	block?: IBlockParams;
	/** False returns the findings without the render; the round is recorded as not seen. */
	includeRender?: boolean;
}

const refused = 'The Figure was not rendered.';

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
 * numeral is not in the figure list. Then it renders (the kernel and the layout engine load on the
 * first call), runs the mechanical fault list, writes `FIG-N.scene.json` and `FIG-N.svg` and the
 * review render of the round, and returns the render with the findings. Three rounds per Figure.
 */
export class RenderFigureTool implements ICopilotTool<IRenderFigureParams> {

	public static readonly toolName = ToolName.RenderFigure;

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IRenderFigureParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return { invocationMessage: l10n.t`Rendering FIG. ${options.input.figure}${options.input.partial ?? ''} of ${options.input.matter}` };
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IRenderFigureParams>, _token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const input = options.input;
		const workspace = await DraftingWorkspace.locate(input.matter, this.workspaceService, this.fileSystemService, this.instantiationService);
		if (typeof workspace === 'string') {
			return textResult(`${refused} ${workspace}`);
		}
		const { folder } = workspace;
		const refusal = (reason: string) => textResult(`${refused} ${reason}`);
		const figure = figureId(input.figure, input.partial);
		if (typeof figure === 'string') {
			return refusal(figure);
		}
		const modes = [input.scene, input.flowchart, input.block].filter(mode => mode !== undefined).length;
		if (modes !== 1) {
			return refusal('Give exactly one of `scene` (a 3D Figure), `flowchart` or `block`.');
		}
		const figures = await workspace.read(folder.figures);
		if (figures === undefined) {
			return refusal(`${folder.figures} does not exist. Every numeral in a Figure is a numeral of the figure list, so write the figure list first.`);
		}
		const label = `FIG. ${figure.key}`;
		const sectionNumbers = parseFigureSections(figures).figures.flatMap(section => figureHeadingNumbers(section.label));
		if (!hasFigure(sectionNumbers, figure.key) && !hasFigure(sectionNumbers, String(figure.number))) {
			return refusal(`${folder.figures} has no heading for ${label} (\`## ${label}\` with its parts). Add the Figure and its parts to the figure list first.`);
		}

		const reviewFolder = `${folder.drawings}/review`;
		const rounds = parseReviewRounds(await workspace.read(`${folder.drawings}/${ROUNDS_FILE}`));
		const done = Math.max(reviewPngCount(await workspace.listFiles(reviewFolder), figure), rounds[figure.key]?.length ?? 0);
		if (done >= MAX_REVIEW_ROUNDS) {
			return refusal(`${label} already had ${done} review rounds; the limit is ${MAX_REVIEW_ROUNDS} per Figure. Edit ${folder.drawings}/FIG-${figure.key}.scene.json by hand, or ask the attorney.`);
		}

		const rendered = input.scene
			? await this.renderScene(input.scene, figure, figures)
			: await this.renderDiagram(workspace, input, figure, figures);
		if (typeof rendered === 'string') {
			return refusal(rendered);
		}

		const round = done + 1;
		const png = `review/FIG-${figure.key}.round-${round}.png`;
		const { rasterizeSvg } = await import('../../drawings/node/raster/rasterize');
		const image = await rasterizeSvg(rendered.svg);
		await workspace.write(`${folder.drawings}/FIG-${figure.key}.scene.json`, rendered.source);
		await workspace.write(`${folder.drawings}/FIG-${figure.key}.svg`, rendered.svg);
		await workspace.write(`${folder.drawings}/${png}`, image.png);
		const seen = input.includeRender !== false && options.model?.capabilities.supportsImageToText !== false;
		const record: ReviewRound = { round, png, seen };
		await workspace.write(`${folder.drawings}/${ROUNDS_FILE}`, renderReviewRounds({ ...rounds, [figure.key]: [...(rounds[figure.key] ?? []), record] }));

		const errors = rendered.findings.filter(finding => finding.severity === 'Error');
		const text = [
			`Rendered ${label}: wrote ${folder.drawings}/FIG-${figure.key}.scene.json, ${folder.drawings}/FIG-${figure.key}.svg and the review render ${folder.drawings}/${png}. Round ${round} of ${MAX_REVIEW_ROUNDS}.`,
			seen ? 'The review render of this round is attached; it is not a deliverable.' : 'No render is attached (the model reads the findings only); the receipt records that no render was seen in this round.',
			rendered.findings.length
				? `Findings (${errors.length} Error(s)):\n${rendered.findings.map(drawingFindingLine).join('\n')}`
				: 'The mechanical fault list found nothing. The attorney still reviews the Figure.',
			errors.length
				? `Fix the Errors in the source and render again${round < MAX_REVIEW_ROUNDS ? '' : '; this was the last round, so edit the scene file by hand or ask the attorney'}.`
				: 'Do not call the Figure compliant or ready to file.',
		].join('\n');
		const parts: (LanguageModelTextPart | LanguageModelDataPart)[] = [new LanguageModelTextPart(text)];
		if (seen) {
			parts.push(LanguageModelDataPart.image(image.png, 'image/png'));
		}
		return new LanguageModelToolResult(parts);
	}

	/** Checks the scene against the figure list, then renders it on the kernel. */
	private async renderScene(input: DrawingScene, figure: FigureId, figures: string): Promise<RenderedSource | string> {
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
		const { renderFigure } = await import('../../drawings/node/kernel/figureRenderer');
		const result = await renderFigure(scene, { allowedNumerals });
		if (!result.svg) {
			return `The scene could not be rendered:\n${result.findings.map(drawingFindingLine).join('\n')}`;
		}
		return { svg: result.svg, source: `${JSON.stringify(scene, null, '\t')}\n`, findings: [...validation.findings, ...result.findings] };
	}

	/** Builds the diagram input from the matter, checks its numerals against the figure list, then draws it. */
	private async renderDiagram(workspace: DraftingWorkspace, input: IRenderFigureParams, figure: FigureId, figures: string): Promise<RenderedSource | string> {
		const { folder } = workspace;
		const office = await workspace.office(await workspace.read(folder.draft));
		if (!office) {
			return `Neither ${folder.draft} nor ${folder.featureList} names the office (\`office: US\` or \`office: EPO\`); a 2D Figure follows the office text rules.`;
		}
		const scheme = readFiguresSettings(figures).numerals;
		const fig = `FIG-${figure.key}`;
		let source: DiagramSource;
		let labels: string[];
		if (input.flowchart) {
			const steps = await this.flowchartSteps(workspace, input.flowchart);
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

		const { numeralFor } = await import('../../drawings/common/diagram/diagramText');
		const listed = new Set(partsOfFigure(figures, figure).map(part => part.numeral));
		const missing = labels.map((text, index) => ({ numeral: String(numeralFor(scheme, figure.number, index)), text })).filter(item => !listed.has(item.numeral));
		if (missing.length) {
			return `Every numeral in a Figure is a numeral of the figure list (${DRAWING_RULES['numeral-not-allowed']}). The ${source.mode === 'flowchart' ? 'steps' : 'blocks'} of FIG. ${figure.key} take these numerals (\`numerals: ${scheme}\`), which are not under its heading in ${folder.figures}:\n${missing.map(item => `- ${item.numeral}: ${item.text}`).join('\n')}\nAdd these lines under the FIG. ${figure.key} heading, then render again.`;
		}

		let result: DiagramResult;
		if (source.mode === 'flowchart') {
			const { drawFlowchart } = await import('../../drawings/common/diagram/flowchart');
			result = await drawFlowchart(source.input);
		} else {
			const { drawBlockDiagram } = await import('../../drawings/common/diagram/blockDiagram');
			result = await drawBlockDiagram(source.input);
		}
		if (!result.svg) {
			return `The diagram was refused:\n${result.findings.map(drawingFindingLine).join('\n')}`;
		}
		const svgFindings: DrawingFinding[] = checkFigureSvgFaults(result.svg, { file: `${fig}.svg`, checks: DIAGRAM_SVG_CHECKS });
		return { svg: result.svg, source: `${JSON.stringify(source, null, '\t')}\n`, findings: [...result.findings, ...svgFindings] };
	}

	/** The steps given in order, or the steps of the approved method claim. */
	private async flowchartSteps(workspace: DraftingWorkspace, flowchart: IFlowchartParams): Promise<DiagramStep[] | string> {
		if (flowchart.fromClaim === undefined) {
			const steps = (flowchart.steps ?? []).map(text => text.trim()).filter(Boolean);
			return steps.length ? steps.map((text, index) => ({ id: `s${index + 1}`, text })) : 'Give the method steps in `flowchart.steps`, or the number of an approved method claim in `flowchart.fromClaim`.';
		}
		if (flowchart.steps?.length) {
			return 'Give either `flowchart.steps` or `flowchart.fromClaim`, not both: the claim is the authority for the steps.';
		}
		const approval = await workspace.requireApprovedClaims();
		if (typeof approval === 'string') {
			return `A flowchart from a claim needs the Approved Claims. ${approval}`;
		}
		const claims = await workspace.read(workspace.folder.claims) ?? '';
		const claim = parseClaims(claims).find(item => item.number === flowchart.fromClaim);
		if (!claim) {
			return `${workspace.folder.claims} has no claim ${flowchart.fromClaim}.`;
		}
		const { stepsFromMethodClaim } = await import('../../drawings/common/diagram/steps');
		const steps = stepsFromMethodClaim(claim.text);
		return steps.length ? steps : `Claim ${claim.number} has no steps to read (a method claim lists its steps after "comprising:").`;
	}
}

ToolRegistry.registerTool(RenderFigureTool);
