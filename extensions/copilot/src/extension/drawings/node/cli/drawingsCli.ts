/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The drawings CLI (PRD 0023, slice D6) of the Agents Window skill `patent-drawings`. A thin
 * argument parser over the drawing ops that the editor tools `render_figure`,
 * `build_drawing_set` and `propose_figure_part` also call, so both surfaces have the same gates,
 * refusals and files. Bundled to `dist/drawings-cli.js` beside the kernel and resvg WebAssembly.
 *
 * ```
 * drawings-cli render <matter> <figure> --scene <file> | --flowchart <file> | --block <file> [--no-render-seen] [--new-cycle]
 * drawings-cli build <matter> [--partial]
 * drawings-cli propose <matter> <figure> <part> [--numeral <n>] [--features F1,F2] [--sketch <file>]
 * drawings-cli reset-rounds <matter> <figure>
 * ```
 *
 * `--new-cycle` starts the next review cycle of the Figure (three more rounds). It has no chat
 * confirmation: the host's command approval and the cap of three cycles are the guard. After three
 * cycles only a person clears the rounds with `reset-rounds`, which no skill names (#696).
 *
 * `<figure>` is `1`, `1A` or `FIG-1A`. `--root <dir>` is the workspace that holds `drafting/`
 * (default: the current folder). Input and sketch files are read relative to the current folder,
 * then the workspace, then the matter folder. A flowchart or block file is checked against its
 * request shape before the render (#797); a scene file is checked by the render itself.
 *
 * Output: one JSON object on stdout. Exit 0 on success, 1 on a refusal (`ok: false` and the
 * reason; nothing was written), 2 on a usage error. No model call.
 */

import { existsSync, promises as fs } from 'fs';
import * as path from 'path';
import { resolveDraftingFolder } from '../../../tools/common/drafting/folderContract';
import { DraftFinding } from '../../../tools/common/drafting/finding';
import type { DrawingScene } from '../../common/scene/drawingScene';
import { buildDrawingSetOp } from '../ops/buildDrawingSetOp';
import { RequestValidation, validateBlockRequest, validateFlowchartRequest } from '../ops/diagramRequestValidator';
import { drawingFindingLine, figureId, MAX_REVIEW_ROUNDS } from '../../common/drawingFiles';
import { NodeMatterFiles } from '../ops/matterFiles';
import { proposeFigurePartOp } from '../ops/proposeFigurePartOp';
import { renderFigureOp, resetReviewRoundsOp } from '../ops/renderFigureOp';

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

/** Thrown for a refusal; the message is the reason. */
class Refusal extends Error { }

/** Thrown for a usage error. */
class UsageError extends Error { }

const USAGE = 'Usage: drawings-cli render <matter> <figure> --scene <file> | --flowchart <file> | --block <file> [--no-render-seen] [--new-cycle]; drawings-cli build <matter> [--partial]; drawings-cli propose <matter> <figure> <part> [--numeral <n>] [--features F1,F2] [--sketch <file>]; drawings-cli reset-rounds <matter> <figure>. Option: --root <workspace>.';

/** Options without a value. */
const FLAGS = new Set(['no-render-seen', 'partial', 'new-cycle']);

/** The parsed command line: positional arguments, `--name value` options and flags. */
interface ParsedArgs {
	readonly positional: readonly string[];
	readonly options: ReadonlyMap<string, string>;
	readonly flags: ReadonlySet<string>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
	const positional: string[] = [];
	const options = new Map<string, string>();
	const flags = new Set<string>();
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith('--')) {
			positional.push(arg);
			continue;
		}
		const name = arg.slice(2);
		if (FLAGS.has(name)) {
			flags.add(name);
			continue;
		}
		const value = argv[i + 1];
		if (value === undefined || value.startsWith('--')) {
			throw new UsageError(`Option ${arg} needs a value.`);
		}
		options.set(name, value);
		i++;
	}
	return { positional, options, flags };
}

/** The matter files of `<root>/drafting/<matter>`. */
function matterFiles(root: string, matter: string | undefined): { files: NodeMatterFiles; dir: string } {
	const folder = matter === undefined ? undefined : resolveDraftingFolder(matter);
	if (!folder) {
		throw new UsageError(`"${matter ?? ''}" is not a matter name. Give the folder name under drafting/, e.g. "widget".`);
	}
	const dir = path.join(root, ...folder.folder.split('/'));
	if (!existsSync(dir)) {
		throw new Refusal(`${folder.folder}/ does not exist in the workspace ${root}.`);
	}
	return { files: new NodeMatterFiles(dir, folder.folder), dir };
}

/** `1`, `1A`, `FIG-1A`, `fig. 2` as a Figure number and partial-view letter. */
function parseFigure(text: string | undefined): { number: number; partial?: string; key: string } {
	const match = /^(?:fig(?:ure)?[-.\s]*)?(?<number>\d+)(?<partial>[A-Za-z])?$/i.exec((text ?? '').trim());
	const figure = match?.groups ? figureId(Number(match.groups.number), match.groups.partial) : `"${text ?? ''}" is not a Figure. Give its number, e.g. 1, 2A or FIG-1.`;
	if (typeof figure === 'string') {
		throw new UsageError(figure);
	}
	return figure;
}

/** The first of the candidate paths that exists. */
function findFile(file: string, folders: readonly string[]): string | undefined {
	return folders.map(folder => path.resolve(folder, file)).find(candidate => existsSync(candidate));
}

/** A JSON object read from an input file. */
async function readJsonObject(file: string, folders: readonly string[], what: string): Promise<object> {
	const found = findFile(file, folders);
	if (!found) {
		throw new Refusal(`The ${what} file ${file} does not exist.`);
	}
	try {
		const value: object | null = JSON.parse(await fs.readFile(found, 'utf8'));
		if (typeof value !== 'object' || value === null || Array.isArray(value)) {
			throw new Error('not an object');
		}
		return value;
	} catch (error) {
		throw new Refusal(`The ${what} file ${file} is not a JSON object: ${error instanceof Error ? error.message : String(error)}.`);
	}
}

/** The typed 2D request, or a refusal with the schema Findings (a scene is checked by the render itself). */
function checkedRequest<T>(validation: RequestValidation<T>, what: string): T {
	if (!validation.request) {
		throw new Refusal(`The ${what} request does not follow the schema:\n${validation.findings.map(drawingFindingLine).join('\n')}`);
	}
	return validation.request;
}

function toCliFinding(finding: DraftFinding & { readonly citation?: string }): { [key: string]: CliValue } {
	return {
		severity: finding.severity,
		rule: finding.rule,
		message: finding.message,
		...(finding.file ? { file: finding.file } : {}),
		...(finding.citation ? { citation: finding.citation } : {}),
		...(finding.waived ? { waived: finding.waived.reason } : {}),
	};
}

async function render(args: ParsedArgs, root: string, cwd: string): Promise<CliOutput> {
	const { files, dir } = matterFiles(root, args.positional[1]);
	const figure = parseFigure(args.positional[2]);
	const modes = (['scene', 'flowchart', 'block'] as const).filter(mode => args.options.has(mode));
	if (modes.length !== 1) {
		throw new UsageError('Give exactly one of --scene (a 3D Figure), --flowchart or --block.');
	}
	const mode = modes[0];
	const input = await readJsonObject(args.options.get(mode)!, [cwd, root, dir], mode);
	const seen = !args.flags.has('no-render-seen');
	const result = await renderFigureOp(files, {
		figure: figure.number,
		...(figure.partial ? { partial: figure.partial } : {}),
		...(mode === 'scene' ? { scene: input as DrawingScene } : mode === 'flowchart' ? { flowchart: checkedRequest(validateFlowchartRequest(input, figure.key), mode) } : { block: checkedRequest(validateBlockRequest(input, figure.key), mode) }),
		seen,
		...(args.flags.has('new-cycle') ? { newCycle: true } : {}),
	});
	if (!result.ok) {
		throw new Refusal(result.reason);
	}
	return {
		ok: true,
		command: 'render',
		figure: `FIG. ${figure.key}`,
		cycle: result.cycle,
		round: result.round,
		roundsLeft: MAX_REVIEW_ROUNDS - result.round,
		seen: result.seen,
		review: result.review,
		errors: result.findings.filter(finding => finding.severity === 'Error').length,
		findings: result.findings.map(toCliFinding),
		text: result.text,
	};
}

async function build(args: ParsedArgs, root: string): Promise<CliOutput> {
	const { files } = matterFiles(root, args.positional[1]);
	const result = await buildDrawingSetOp(files, { partial: args.flags.has('partial') });
	if (!result.ok) {
		throw new Refusal(result.reason);
	}
	const count = (value: string) => result.checks.filter(check => check.result === value).length;
	return {
		ok: true,
		command: 'build',
		sheets: result.sheets,
		pageSize: result.pageSize,
		receipt: {
			file: `${files.folder}/drawings/drawings-compliance.md`,
			pass: count('pass'),
			fail: count('fail'),
			notChecked: count('not-checked'),
		},
		manifestUpdated: result.manifestUpdated,
		missing: result.missing,
		text: result.text,
	};
}

async function propose(args: ParsedArgs, root: string, cwd: string): Promise<CliOutput> {
	const { files, dir } = matterFiles(root, args.positional[1]);
	const figureText = args.positional[2];
	const figure = Number(figureText);
	if (!figureText || !Number.isInteger(figure) || figure < 1) {
		throw new UsageError('Give the figure number the part is drawn in: propose <matter> <figure> <part>.');
	}
	const sketchPath = args.options.get('sketch');
	let sketch: { name: string; bytes: Uint8Array } | undefined;
	if (sketchPath) {
		const found = findFile(sketchPath, [cwd, root, dir]);
		if (!found) {
			throw new Refusal(`The sketch ${sketchPath} does not exist in the current folder, the workspace or ${files.folder}/.`);
		}
		sketch = { name: path.basename(found), bytes: new Uint8Array(await fs.readFile(found)) };
	}
	const result = await proposeFigurePartOp(files, {
		figure,
		part: args.positional.slice(3).join(' '),
		...(args.options.has('numeral') ? { numeral: args.options.get('numeral') } : {}),
		...(args.options.has('features') ? { features: args.options.get('features')!.split(',').map(feature => feature.trim()).filter(Boolean) } : {}),
		...(sketch ? { sketch } : {}),
	});
	if (!result.ok) {
		throw new Refusal(result.reason);
	}
	return {
		ok: true,
		command: 'propose',
		file: `${files.folder}/figures.md`,
		added: result.line,
		numeral: result.numeral,
		sketch: result.sketch ? `${files.folder}/${result.sketch}` : undefined,
		text: result.text,
	};
}

/** Clears the review rounds of one Figure; a human step (#696). Prints what it cleared. */
async function resetRounds(args: ParsedArgs, root: string): Promise<CliOutput> {
	const { files } = matterFiles(root, args.positional[1]);
	const figure = parseFigure(args.positional[2]);
	const label = `FIG. ${figure.key}`;
	const result = await resetReviewRoundsOp(files, figure);
	return {
		ok: true,
		command: 'reset-rounds',
		figure: label,
		cleared: { cycle: result.cycle, rounds: result.rounds },
		deleted: result.deleted,
		text: result.cycle === 0
			? `${label} had no review rounds; nothing to clear.`
			: `Cleared ${label}: review cycle ${result.cycle} with ${result.rounds} round(s) used, and ${result.deleted.length} review render(s). The next render is round 1 of cycle 1.`,
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
			case 'reset-rounds': return { exitCode: 0, output: await resetRounds(args, root) };
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
