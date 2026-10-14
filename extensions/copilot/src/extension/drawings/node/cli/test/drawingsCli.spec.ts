/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { existsSync, promises as fs } from 'fs';
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

const CLAIM = '1. A method of cooling a battery pack, comprising: measuring a cell temperature with a sensor; comparing the cell temperature with a limit; and opening a coolant valve when the cell temperature exceeds the limit.';

interface Run {
	readonly exitCode: number;
	readonly output: CliOutput;
}

/** The rule ids of the Findings a refusal lists. */
function rules(run: Run): string[] {
	return ((run.output.findings ?? []) as readonly { readonly rule: string }[]).map(finding => finding.rule);
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
		await fs.writeFile(path.join(workspace, 'flow.json'), JSON.stringify({ claim: CLAIM }));
	});

	afterEach(async () => {
		await fs.rm(workspace, { recursive: true, force: true });
	});

	async function writeScene(name: string, edit: (scene: { numerals: { numeral: string }[] }) => void): Promise<void> {
		const scene = JSON.parse(await fs.readFile(path.join(FIXTURES, 'box-two-numerals.scene.json'), 'utf8'));
		edit(scene);
		await fs.writeFile(path.join(workspace, name), JSON.stringify(scene));
	}

	it('renders a scene Figure and a flowchart Figure, then builds the Drawing Set', async () => {
		const scene = await runCli(workspace, ['render', 'widget', '1', '--scene', 'box.json']);
		const flowchart = await runCli(workspace, ['render', 'widget', 'FIG-2', '--flowchart', 'flow.json']);
		const build = await runCli(workspace, ['build', 'widget']);
		expect({ files: await listFiles(matterDir), scene, flowchart, build }).toMatchSnapshot();
	}, 120_000);

	describe('refusals', () => {
		it('refuses a matter that does not exist', async () => {
			const run = await runCli(workspace, ['render', 'other', '1', '--scene', 'box.json']);
			expect({ exitCode: run.exitCode, reason: run.output.reason?.replace(workspace, '<workspace>') }).toEqual({ exitCode: 1, reason: 'The matter folder drafting/other/ does not exist under <workspace>.' });
		});

		it('refuses a Figure that figures.md does not list', async () => {
			const run = await runCli(workspace, ['render', 'widget', '3', '--scene', 'box.json']);
			expect({ exitCode: run.exitCode, reason: run.output.reason }).toEqual({ exitCode: 1, reason: 'FIG. 3 is not in drafting/widget/figures.md (Figures: 1, 2). Add a "## FIG. 3" heading with its parts first.' });
		});

		it('refuses a numeral outside figures.md and writes nothing', async () => {
			await writeScene('bad.json', scene => scene.numerals[0].numeral = '99');
			const run = await runCli(workspace, ['render', 'widget', '1', '--scene', 'bad.json']);
			expect({ exitCode: run.exitCode, rules: rules(run), drawings: existsSync(path.join(matterDir, 'drawings')) }).toEqual({ exitCode: 1, rules: ['numeral-not-allowed'], drawings: false });
		});

		it('refuses a numeral the attorney has not confirmed', async () => {
			await fs.writeFile(path.join(matterDir, 'figures.md'), FIGURES_MD.replace('- 12: top surface', '- 12: top surface (proposed)'));
			const run = await runCli(workspace, ['render', 'widget', '1', '--scene', 'box.json']);
			expect({ exitCode: run.exitCode, rules: rules(run) }).toEqual({ exitCode: 1, rules: ['numeral-not-allowed'] });
		});

		it('refuses a scene that does not validate, without using a round', async () => {
			await writeScene('bad.json', scene => Object.assign(scene, { camera: 'oblique' }));
			const run = await runCli(workspace, ['render', 'widget', '1', '--scene', 'bad.json']);
			expect({ exitCode: run.exitCode, rules: rules(run), review: existsSync(path.join(matterDir, 'drawings', 'review')) }).toEqual({ exitCode: 1, rules: ['scene-schema'], review: false });
		});

		it('refuses a fourth round', async () => {
			await fs.mkdir(path.join(matterDir, 'drawings', 'review'), { recursive: true });
			for (const round of [1, 2, 3]) {
				await fs.writeFile(path.join(matterDir, 'drawings', 'review', `FIG-1.round-${round}.png`), 'png');
			}
			const run = await runCli(workspace, ['render', 'widget', '1', '--scene', 'box.json']);
			expect({ exitCode: run.exitCode, reason: run.output.reason }).toEqual({ exitCode: 1, reason: 'FIG. 1 has used its 3 review rounds. Report the open Findings to the attorney; the attorney starts new rounds by deleting drawings/review/FIG-1.round-*.png.' });
		});

		it('refuses a flowchart proposal that adds a step', async () => {
			await fs.writeFile(path.join(workspace, 'flow.json'), JSON.stringify({ claim: CLAIM, proposal: { nodes: [{ id: 'extra', kind: 'process', text: 'invented step', after: 's1' }] } }));
			const run = await runCli(workspace, ['render', 'widget', '2', '--flowchart', 'flow.json']);
			expect({ exitCode: run.exitCode, rules: rules(run) }).toEqual({ exitCode: 1, rules: ['node-count'] });
		});

		it('refuses a diagram when no office is set', async () => {
			await fs.writeFile(path.join(matterDir, 'feature-list.md'), FEATURE_LIST_MD.replace('office: US\n', ''));
			const run = await runCli(workspace, ['render', 'widget', '2', '--flowchart', 'flow.json']);
			expect({ exitCode: run.exitCode, reason: run.output.reason }).toEqual({ exitCode: 1, reason: 'No office: drafting/widget/feature-list.md sets no `office` (US or EPO). Set it there, or pass --office US, EPO or PCT.' });
		});

		it('refuses to build with a proposal in figures.md', async () => {
			await fs.writeFile(path.join(matterDir, 'figures.md'), `${FIGURES_MD}- 14: bracket (proposed from sketches/sketch-1.png)\n`);
			const run = await runCli(workspace, ['build', 'widget']);
			expect({ exitCode: run.exitCode, rules: rules(run) }).toEqual({ exitCode: 1, rules: ['figure-proposal'] });
		});

		it('refuses to build Letter sheets for the EPO', async () => {
			await fs.writeFile(path.join(matterDir, 'figures.md'), FIGURES_MD.replace('numerals: hundreds', 'numerals: hundreds\npageSize: letter'));
			await fs.writeFile(path.join(matterDir, 'feature-list.md'), FEATURE_LIST_MD.replace('office: US', 'office: EPO'));
			const run = await runCli(workspace, ['build', 'widget']);
			expect({ exitCode: run.exitCode, rules: rules(run) }).toEqual({ exitCode: 1, rules: ['figures-settings'] });
		});

		it('refuses to build with no rendered Figure', async () => {
			const run = await runCli(workspace, ['build', 'widget']);
			expect({ exitCode: run.exitCode, reason: run.output.reason }).toEqual({ exitCode: 1, reason: 'drafting/widget/drawings/ has no FIG-N.svg. Render each Figure first.' });
		});

		it('refuses to build with an open Figure Error', async () => {
			await fs.mkdir(path.join(matterDir, 'drawings'), { recursive: true });
			await fs.writeFile(path.join(matterDir, 'drawings', 'FIG-1.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="20mm" viewBox="0 0 50 20"><text class="numeral" x="5" y="10" font-size="2">10</text></svg>');
			const run = await runCli(workspace, ['build', 'widget']);
			expect({ exitCode: run.exitCode, rules: rules(run) }).toEqual({ exitCode: 1, rules: ['glyph-too-small', 'lead-line-missing'] });
		});

		it('refuses to propose a numeral that figures.md already uses', async () => {
			const run = await runCli(workspace, ['propose', 'widget', '10', 'bracket', '--sketch', 'sketches/sketch-1.png']);
			expect({ exitCode: run.exitCode, reason: run.output.reason }).toEqual({ exitCode: 1, reason: 'Numeral 10 is already "housing" in drafting/widget/figures.md (line 6). Give the new part another numeral.' });
		});

		it('refuses to propose from a sketch that does not exist', async () => {
			const run = await runCli(workspace, ['propose', 'widget', '14', 'bracket', '--sketch', 'sketches/missing.png']);
			expect({ exitCode: run.exitCode, reason: run.output.reason }).toEqual({ exitCode: 1, reason: 'The sketch sketches/missing.png does not exist in drafting/widget/ or the workspace. Copy it to drafting/widget/sketches/ first.' });
		});
	});

	it('appends a proposal under its Figure heading', async () => {
		const run = await runCli(workspace, ['propose', 'widget', '14', 'bracket', '--sketch', 'sketches/sketch-1.png', '--figure', '1']);
		expect({ exitCode: run.exitCode, output: run.output, figures: await fs.readFile(path.join(matterDir, 'figures.md'), 'utf8') }).toMatchSnapshot();
	});
});
