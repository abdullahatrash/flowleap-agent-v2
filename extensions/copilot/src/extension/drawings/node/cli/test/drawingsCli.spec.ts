/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CliOutput } from '../drawingsCli';

/** The extension root: six folders up from this test folder. */
const EXTENSION_ROOT = path.resolve(__dirname, '../../../../../..');
const CLI = path.join(EXTENSION_ROOT, 'src/extension/drawings/node/cli/drawingsCli.ts');
const TSX = path.join(EXTENSION_ROOT, 'node_modules/tsx/dist/cli.mjs');
const FIXTURES = path.join(EXTENSION_ROOT, 'src/extension/drawings/node/kernel/test/fixtures');

const FIGURES_MD = `---
numerals: hundreds
---
## FIG. 1

- 10: housing [F1]
- 12: top surface

## FIG. 2

- 202: measure the temperature
- 204: compare with the limit
- 206: open the valve
`;

const FEATURE_LIST_MD = `---
office: US
confirmed: true
---
| ID | Feature | Source |
|---|---|---|
| F1 | housing | disclosure, page 1 |
`;

const STEPS = ['measure the cell temperature', 'compare with the limit', 'open the coolant valve'];

interface Run {
	readonly exitCode: number;
	readonly output: CliOutput;
}



/** Runs the CLI from its TypeScript source with tsx, as `npx tsx drawingsCli.ts ...` does. */
function runCli(cwd: string, args: readonly string[]): Promise<Run> {
	return new Promise((resolve, reject) => {
		execFile(process.execPath, [TSX, CLI, ...args], { cwd, timeout: 120_000 }, (error, stdout) => {
			const exitCode = error && typeof error.code === 'number' ? error.code : 0;
			try {
				resolve({ exitCode, output: JSON.parse(stdout) });
			} catch {
				reject(error ?? new Error(`No JSON on stdout: ${stdout}`));
			}
		});
	});
}

/** The files under `dir`, relative, sorted. */
async function listFiles(dir: string): Promise<string[]> {
	const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
	return entries.filter(entry => entry.isFile()).map(entry => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')).sort();
}

describe('drawings CLI', () => {
	let workspace: string;
	let matterDir: string;

	beforeEach(async () => {
		workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'drawings-cli-')));
		matterDir = path.join(workspace, 'drafting', 'widget');
		await fs.mkdir(path.join(matterDir, 'sketches'), { recursive: true });
		await fs.writeFile(path.join(matterDir, 'figures.md'), FIGURES_MD);
		await fs.writeFile(path.join(matterDir, 'feature-list.md'), FEATURE_LIST_MD);
		await fs.writeFile(path.join(matterDir, 'sketches', 'sketch-1.png'), 'png');
		await fs.copyFile(path.join(FIXTURES, 'box-two-numerals.scene.json'), path.join(workspace, 'box.json'));
		await fs.writeFile(path.join(workspace, 'flow.json'), JSON.stringify({ steps: STEPS }));
	});

	afterEach(async () => {
		await fs.rm(workspace, { recursive: true, force: true });
	});

	/** A refusal as the snapshot records it: the exit code and the reason, with the temp folder replaced. */
	function refusal(run: Run): { exitCode: number; ok: boolean; reason: string | undefined } {
		return { exitCode: run.exitCode, ok: run.output.ok, reason: run.output.reason?.split(workspace).join('<workspace>') };
	}

	it('renders a scene Figure and a flowchart Figure, then builds the Drawing Set', async () => {
		const scene = await runCli(workspace, ['render', 'widget', '1', '--scene', 'box.json']);
		const flowchart = await runCli(workspace, ['render', 'widget', 'FIG-2', '--flowchart', 'flow.json']);
		const build = await runCli(workspace, ['build', 'widget']);
		const rounds = JSON.parse(await fs.readFile(path.join(matterDir, 'drawings', 'rounds.json'), 'utf8'));
		expect({ files: await listFiles(matterDir), scene, flowchart, build, rounds }).toMatchSnapshot();
	}, 120_000);

	it('refuses a build while a Figure of figures.md is not drawn, and builds it for review with --partial', async () => {
		await fs.mkdir(path.join(matterDir, 'drawings'), { recursive: true });
		await fs.writeFile(path.join(matterDir, 'drawings', 'FIG-2.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="20mm" viewBox="0 0 50 20"/>');
		await fs.writeFile(path.join(matterDir, 'filing-manifest.md'), 'manifest of the export');
		const refused = await runCli(workspace, ['build', 'widget']);
		const partial = await runCli(workspace, ['build', 'widget', '--partial']);
		const sheet = await fs.readFile(path.join(matterDir, 'drawings', 'sheet-1.svg'), 'utf8');
		const receipt = await fs.readFile(path.join(matterDir, 'drawings', 'drawings-compliance.md'), 'utf8');
		expect({
			refused: refusal(refused),
			partial: { exitCode: partial.exitCode, missing: partial.output.missing, manifestUpdated: partial.output.manifestUpdated },
			figLabels: [...sheet.matchAll(/class="fig-label"[^>]*>(?<label>[^<]*)</g)].map(match => match.groups?.label),
			receiptFirstLine: receipt.split('\n')[0],
			manifest: await fs.readFile(path.join(matterDir, 'filing-manifest.md'), 'utf8'),
		}).toMatchSnapshot();
	}, 120_000);

	it('records a round the model did not see with --no-render-seen', async () => {
		const run = await runCli(workspace, ['render', 'widget', '1', '--scene', 'box.json', '--no-render-seen']);
		const rounds = JSON.parse(await fs.readFile(path.join(matterDir, 'drawings', 'rounds.json'), 'utf8'));
		expect({ exitCode: run.exitCode, seen: run.output.seen, rounds }).toEqual({ exitCode: 0, seen: false, rounds: { figures: { '1': { cycle: 1, rounds: [{ round: 1, png: 'review/FIG-1.round-1.png', seen: false }] } } } });
	}, 120_000);

	it('starts a new review cycle with --new-cycle, and reset-rounds is no command', async () => {
		await fs.mkdir(path.join(matterDir, 'drawings'), { recursive: true });
		const rounds = [1, 2, 3].map(round => ({ round, png: `review/FIG-1.round-${round}.png`, seen: false }));
		await fs.writeFile(path.join(matterDir, 'drawings', 'rounds.json'), JSON.stringify({ figures: { '1': rounds } }));
		const refused = await runCli(workspace, ['render', 'widget', '1', '--scene', 'box.json']);
		const next = await runCli(workspace, ['render', 'widget', '1', '--scene', 'box.json', '--new-cycle', '--no-render-seen']);
		const reset = await runCli(workspace, ['reset-rounds', 'widget', 'FIG-1']);
		const roundsAfter = JSON.parse(await fs.readFile(path.join(matterDir, 'drawings', 'rounds.json'), 'utf8'));
		expect({
			refused: refusal(refused),
			next: { exitCode: next.exitCode, cycle: next.output.cycle, round: next.output.round, roundsLeft: next.output.roundsLeft, review: next.output.review },
			reset: { exitCode: reset.exitCode, ok: reset.output.ok, command: reset.output.command },
			roundsAfter,
		}).toEqual({
			refused: { exitCode: 1, ok: false, reason: 'Three review rounds used for FIG. 1 in cycle 1. Start a new cycle only when the attorney asked for more work on this Figure (newCycle).' },
			next: { exitCode: 0, cycle: 2, round: 1, roundsLeft: 2, review: 'drafting/widget/drawings/review/FIG-1.cycle-2.round-1.png' },
			reset: { exitCode: 2, ok: false, command: 'reset-rounds' },
			roundsAfter: { figures: { '1': { cycle: 2, rounds: [{ round: 1, png: 'review/FIG-1.cycle-2.round-1.png', seen: false }] } } },
		});
	}, 120_000);

	it('proposes a part with the next numeral of the scheme and copies the sketch', async () => {
		await fs.writeFile(path.join(workspace, 'photo of bracket.png'), 'png');
		const run = await runCli(workspace, ['propose', 'widget', '1', 'bracket', '--features', 'f1', '--sketch', 'photo of bracket.png']);
		expect({ run, files: await listFiles(matterDir), figures: await fs.readFile(path.join(matterDir, 'figures.md'), 'utf8') }).toMatchSnapshot();
	});

	describe('refusals', () => {
		const cases: { name: string; setup?: (workspace: string, matterDir: string) => Promise<void>; args: string[] }[] = [
			{ name: 'a matter that does not exist', args: ['render', 'other', '1', '--scene', 'box.json'] },
			{ name: 'a Figure with no heading in figures.md', args: ['render', 'widget', '3', '--scene', 'box.json'] },
			{
				name: 'a numeral outside figures.md', args: ['render', 'widget', '1', '--scene', 'bad.json'],
				setup: async workspace => {
					const scene = JSON.parse(await fs.readFile(path.join(FIXTURES, 'box-two-numerals.scene.json'), 'utf8'));
					scene.numerals[0].numeral = '98';
					await fs.writeFile(path.join(workspace, 'bad.json'), JSON.stringify(scene));
				},
			},
			{
				name: 'a scene that does not follow the schema', args: ['render', 'widget', '1', '--scene', 'bad.json'],
				setup: async workspace => {
					const scene = JSON.parse(await fs.readFile(path.join(FIXTURES, 'box-two-numerals.scene.json'), 'utf8'));
					await fs.writeFile(path.join(workspace, 'bad.json'), JSON.stringify({ ...scene, camera: 'oblique' }));
				},
			},
			{
				name: 'a fourth round in a review cycle', args: ['render', 'widget', '1', '--scene', 'box.json'],
				setup: async (_workspace, matterDir) => {
					await fs.mkdir(path.join(matterDir, 'drawings'), { recursive: true });
					const rounds = [1, 2, 3].map(round => ({ round, png: `review/FIG-1.round-${round}.png`, seen: false }));
					await fs.writeFile(path.join(matterDir, 'drawings', 'rounds.json'), JSON.stringify({ figures: { '1': rounds } }));
				},
			},
			{
				name: 'step numerals that are not under the Figure heading', args: ['render', 'widget', '2', '--flowchart', 'flow.json'],
				setup: async workspace => fs.writeFile(path.join(workspace, 'flow.json'), JSON.stringify({ steps: [...STEPS, 'close the valve'] })),
			},
			{
				name: 'a 2D Figure with no office', args: ['render', 'widget', '2', '--flowchart', 'flow.json'],
				setup: async (_workspace, matterDir) => fs.writeFile(path.join(matterDir, 'feature-list.md'), FEATURE_LIST_MD.replace('office: US\n', '')),
			},
			{
				name: 'a flowchart from a claim that is not approved', args: ['render', 'widget', '2', '--flowchart', 'flow.json'],
				setup: async (workspace, matterDir) => {
					await fs.writeFile(path.join(matterDir, 'claims.md'), '---\napproved: false\n---\n1. A method, comprising: measuring; comparing; and opening.\n');
					await fs.writeFile(path.join(workspace, 'flow.json'), JSON.stringify({ fromClaim: 1 }));
				},
			},
			{
				name: 'a flowchart proposal that adds a step', args: ['render', 'widget', '2', '--flowchart', 'flow.json'],
				setup: async workspace => fs.writeFile(path.join(workspace, 'flow.json'), JSON.stringify({ steps: STEPS, proposal: { nodes: [{ id: 'extra', kind: 'process', text: 'invented step', after: 's1' }] } })),
			},
			{
				name: 'a flowchart request that does not follow the schema', args: ['render', 'widget', '2', '--flowchart', 'flow.json'],
				setup: async workspace => fs.writeFile(path.join(workspace, 'flow.json'), JSON.stringify({ steps: 'measure, compare, open', fromClaim: '1', proposal: { nodes: [{ id: 'd1', kind: 'loop' }], edges: [{ from: 'd1' }] } })),
			},
			{
				name: 'a block request that does not follow the schema', args: ['render', 'widget', '2', '--block', 'blocks.json'],
				setup: async workspace => fs.writeFile(path.join(workspace, 'blocks.json'), JSON.stringify({ blocks: [{ id: 'b1' }, { label: 'controller' }], connections: [{ from: 'b1', to: 'b2', direction: 'up' }] })),
			},
			{ name: 'a build with no rendered Figure', args: ['build', 'widget'] },
			{
				name: 'a build with a proposal in figures.md', args: ['build', 'widget'],
				setup: async (_workspace, matterDir) => {
					await fs.mkdir(path.join(matterDir, 'drawings'), { recursive: true });
					await fs.writeFile(path.join(matterDir, 'drawings', 'FIG-1.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="20mm" viewBox="0 0 50 20"/>');
					await fs.writeFile(path.join(matterDir, 'drawings', 'FIG-2.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="20mm" viewBox="0 0 50 20"/>');
					await fs.appendFile(path.join(matterDir, 'figures.md'), '- 14: bracket (proposed from sketches/sketch-1.png)\n');
				},
			},
			{
				name: 'a build of Letter sheets for the EPO', args: ['build', 'widget'],
				setup: async (_workspace, matterDir) => {
					await fs.mkdir(path.join(matterDir, 'drawings'), { recursive: true });
					await fs.writeFile(path.join(matterDir, 'drawings', 'FIG-1.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="20mm" viewBox="0 0 50 20"/>');
					await fs.writeFile(path.join(matterDir, 'drawings', 'FIG-2.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="20mm" viewBox="0 0 50 20"/>');
					await fs.writeFile(path.join(matterDir, 'figures.md'), FIGURES_MD.replace('numerals: hundreds', 'numerals: hundreds\npageSize: letter'));
					await fs.writeFile(path.join(matterDir, 'feature-list.md'), FEATURE_LIST_MD.replace('office: US', 'office: EPO'));
				},
			},
			{
				name: 'a build with an open Figure Error', args: ['build', 'widget'],
				setup: async (_workspace, matterDir) => {
					await fs.mkdir(path.join(matterDir, 'drawings'), { recursive: true });
					await fs.writeFile(path.join(matterDir, 'drawings', 'FIG-1.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="20mm" viewBox="0 0 50 20"><text class="numeral" x="5" y="10" font-size="2">10</text></svg>');
					await fs.writeFile(path.join(matterDir, 'drawings', 'FIG-2.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="20mm" viewBox="0 0 50 20"/>');
				},
			},
			{ name: 'a proposal with a used numeral', args: ['propose', 'widget', '1', 'bracket', '--numeral', '10'] },
			{ name: 'a proposal outside the numeral scheme', args: ['propose', 'widget', '1', 'bracket', '--numeral', '304'] },
			{ name: 'a proposal from a sketch that does not exist', args: ['propose', 'widget', '1', 'bracket', '--sketch', 'sketches/missing.png'] },
		];
		for (const item of cases) {
			it(`refuses ${item.name} and writes no drawing`, async () => {
				await item.setup?.(workspace, matterDir);
				const before = await listFiles(matterDir);
				const run = await runCli(workspace, item.args);
				expect({ ...refusal(run), wrote: (await listFiles(matterDir)).filter(file => !before.includes(file)) }).toMatchSnapshot();
			});
		}
	});
});
