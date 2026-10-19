/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs, readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DrawingScene } from '../../../common/scene/drawingScene';
import { buildDrawingSetOp } from '../buildDrawingSetOp';
import { NodeMatterFiles } from '../matterFiles';
import { proposeFigurePartOp } from '../proposeFigurePartOp';
import { readReviewState, RenderFigureInput, renderFigureOp, RenderFigureResult, resetReviewRoundsOp } from '../renderFigureOp';

const KERNEL_TIMEOUT = 60_000;

const scene: DrawingScene = JSON.parse(readFileSync(path.join(__dirname, '../../kernel/test/fixtures/box-two-numerals.scene.json'), 'utf8'));

const featureList = `---
office: US
confirmed: true
---
| ID | Feature | Source |
| --- | --- | --- |
| F1 | A housing 10 with a top face 12. | disclosure:§1 |
| F2 | Measuring and comparing a temperature. | disclosure:§2 |
`;

const claims = `---
approved: true
---
1. A housing comprising a top face.
2. A method of cooling a battery pack, comprising: measuring a cell temperature with a sensor; comparing the cell temperature with a limit; and opening a coolant valve when the cell temperature exceeds the limit.
`;

const figures = `---
numerals: even
---
## FIG. 1

- 10: housing [F1]
- 12: top face

## FIG. 2

- 2: measuring a cell temperature [F2]
- 4: comparing the cell temperature
- 6: opening a coolant valve
`;

/** The figure list of the founder's D7 pipe-clamp matter (2026-10-19): parts 10 to 42 in FIG. 1 and FIG. 2, the FIG. 3 flowchart steps 44 to 52. */
const pipeClampFigures = readFileSync(path.join(__dirname, 'fixtures/pipe-clamp.figures.md'), 'utf8');

/** The five steps of the D7 method claim, as the FIG. 3 heading lists them. */
const pipeClampSteps = [
	'placing the pipe in the saddle groove',
	'pivoting the cap about the hinge pin onto the pipe',
	'compressing the spring with the cap',
	'pushing the locking pin through the latch lug and the cap latch lug',
	'releasing the cap, the locking pin holding the cap closed against the spring',
];

const outline = `---
office: US
claims: 0
---
# Draft Outline

| Item | Section | Kind | Claims | Claim terms | Sources | Explain | Question |
|------|---------|------|--------|-------------|---------|---------|----------|
| O1 | DETAILED DESCRIPTION | Technical | 1 | a housing | F1, FIG. 1 | yes |  |
`;

const matter: Record<string, string> = {
	'feature-list.md': featureList,
	'claims.md': claims,
	'figures.md': figures,
	'draft-outline.md': outline,
};

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

/** A matter folder `drafting/hinge/` in a new temporary directory, with the given files. */
async function setup(files: Record<string, string> = matter) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'drawing-ops-'));
	roots.push(root);
	const folder = path.join(root, 'drafting', 'hinge');
	const matterFiles = new NodeMatterFiles(folder);
	for (const [file, contents] of Object.entries(files)) {
		await matterFiles.write(file, contents);
	}
	const render = (input: Omit<RenderFigureInput, 'seen'> & { seen?: boolean }) => renderFigureOp(matterFiles, { seen: true, ...input });
	const read = (file: string) => matterFiles.read(file);
	return { files: matterFiles, render, read };
}

/** A render result with its PNG bytes replaced by a marker, for a snapshot. */
function withoutBytes(result: RenderFigureResult) {
	return result.ok ? { ...result, png: result.png.length ? 'PNG' : 'empty' } : result;
}

describe('renderFigureOp', () => {
	it('refuses a Figure without a heading in figures.md, and writes nothing', async () => {
		const { render, files } = await setup();
		expect({ result: await render({ figure: 3, scene }), drawings: await files.listFiles('drawings') }).toEqual({
			result: { ok: false, reason: 'drafting/hinge/figures.md has no heading for FIG. 3 (`## FIG. 3` with its parts). Add the Figure and its parts to the figure list first.' },
			drawings: [],
		});
	});

	it('refuses a numeral that figures.md does not list', async () => {
		const { render } = await setup();
		expect(await render({ figure: 1, scene: { ...scene, numerals: [...scene.numerals, { numeral: '14', part: 'housing', face: 'top' }] } })).toEqual({
			ok: false,
			reason: 'Every part drawn has a numeral, and every numeral is in the figure list:\n- Error `numeral-not-allowed` (FIG-1.scene.json): Numeral 14 is not in the figures list (allowed: 10, 12, 2, 4, 6). [37 CFR 1.84(p)(5); OJ EPO 2025 A49 Art. 1(2)(i); PCT Rule 11.13(l)]\nAdd the part to the figure list (propose_figure_part when the disclosure does not state it), or remove it from the scene.',
		});
	});

	it('refuses a part without a numeral', async () => {
		const { render } = await setup();
		expect(await render({ figure: 1, scene: { ...scene, parts: [...scene.parts, { id: 'lid', shape: { kind: 'box', size: [10, 10, 2] } }] } })).toMatchSnapshot();
	});

	it('refuses 2D numerals that are not under the Figure heading, listing the lines to add', async () => {
		const { render } = await setup();
		expect(await render({ figure: 2, flowchart: { steps: ['measure the temperature', 'compare it with a limit', 'open the valve', 'close the valve'] } })).toMatchSnapshot();
	});

	it('draws the FIG. 3 flowchart of the D7 matter with the numerals 44 to 52 listed under its heading, not the scheme series (#786)', async () => {
		const { render, read } = await setup({ ...matter, 'figures.md': pipeClampFigures });
		const result = await render({ figure: 3, flowchart: { steps: pipeClampSteps } });
		const svg = await read('drawings/FIG-3.svg') ?? '';
		expect({
			ok: result.ok,
			errors: result.ok ? result.findings.filter(finding => finding.severity === 'Error') : result.reason,
			numerals: [...svg.matchAll(/<text class="numeral" data-numeral="(?<numeral>\d+)"/g)].map(match => Number(match.groups?.numeral)),
			sourceNumerals: JSON.parse(await read('drawings/FIG-3.scene.json') ?? '{}').input?.numerals,
		}).toEqual({ ok: true, errors: [], numerals: [44, 46, 48, 50, 52], sourceNumerals: [44, 46, 48, 50, 52] });
	}, KERNEL_TIMEOUT);

	it('refuses a 2D Figure whose heading lists nothing (free numerals suggested), another count, or a numeral of another Figure (#786)', async () => {
		const noLines = pipeClampFigures.replace(/- 4[4-9]:[^\n]*\n|- 5[0-2]:[^\n]*\n/g, '');
		const fourLines = pipeClampFigures.replace(/- 52:[^\n]*\n/, '');
		const clash = pipeClampFigures.replace('- 44: placing', '- 10: placing');
		const hundreds = pipeClampFigures.replace('numerals: even', 'numerals: hundreds');
		const run = async (figures: string, input: Omit<RenderFigureInput, 'seen'>) => (await setup({ ...matter, 'figures.md': figures })).render(input);
		expect({
			noLines: await run(noLines, { figure: 3, flowchart: { steps: pipeClampSteps } }),
			fourLines: await run(fourLines, { figure: 3, flowchart: { steps: pipeClampSteps } }),
			clash: await run(clash, { figure: 3, flowchart: { steps: pipeClampSteps } }),
			hundredsNoLines: await run(hundreds.replace(/- 4[4-9]:[^\n]*\n|- 5[0-2]:[^\n]*\n/g, ''), { figure: 3, block: { blocks: [{ id: 'a', label: 'Pump' }, { id: 'b', label: 'Valve' }] } }),
		}).toMatchSnapshot();
	});

	it('refuses a flowchart from a claim while the claims are not approved', async () => {
		const { render } = await setup({ ...matter, 'claims.md': claims.replace('approved: true', 'approved: false') });
		expect(await render({ figure: 2, flowchart: { fromClaim: 2 } })).toEqual({
			ok: false,
			reason: 'A flowchart from a claim needs the Approved Claims. `approved` in drafting/hinge/claims.md is not `true`. The attorney sets `approved: true` after review; a statement in chat does not open this gate.',
		});
	});

	it('refuses a fourth round in a review cycle', async () => {
		const { render, files } = await setup();
		for (const round of [1, 2, 3]) {
			await files.write(`drawings/review/FIG-1.round-${round}.png`, 'png');
		}
		expect({ result: await render({ figure: 1, scene }), review: await files.listFiles('drawings/review') }).toEqual({
			result: { ok: false, reason: 'Three review rounds used for FIG. 1 in cycle 1. Start a new cycle only when the attorney asked for more work on this Figure (newCycle).' },
			review: ['FIG-1.round-1.png', 'FIG-1.round-2.png', 'FIG-1.round-3.png'],
		});
	});

	it('reads the first rounds.json shape as cycle 1, and newCycle renders round 1 of cycle 2 in the new shape', async () => {
		const { render, read, files } = await setup();
		const oldRounds = [1, 2, 3].map(round => ({ round, png: `review/FIG-1.round-${round}.png`, seen: true }));
		await files.write('drawings/rounds.json', JSON.stringify({ figures: { '1': oldRounds } }));
		const result = await render({ figure: 1, scene, newCycle: true });
		expect({
			result: result.ok ? { cycle: result.cycle, round: result.round, review: result.review, first: result.text.split('\n')[0] } : result,
			review: await files.listFiles('drawings/review'),
			rounds: JSON.parse(await read('drawings/rounds.json') ?? '{}'),
		}).toEqual({
			result: {
				cycle: 2,
				round: 1,
				review: 'drafting/hinge/drawings/review/FIG-1.cycle-2.round-1.png',
				first: 'Rendered FIG. 1: wrote drafting/hinge/drawings/FIG-1.scene.json, drafting/hinge/drawings/FIG-1.svg and the review render drafting/hinge/drawings/review/FIG-1.cycle-2.round-1.png. Round 1 of 3 in review cycle 2.',
			},
			review: ['FIG-1.cycle-2.round-1.png'],
			rounds: { figures: { '1': { cycle: 2, rounds: [{ round: 1, png: 'review/FIG-1.cycle-2.round-1.png', seen: true }] } } },
		});
	}, KERNEL_TIMEOUT);

	it('refuses for good after three cycles, with or without newCycle; the review renders count when rounds.json is gone', async () => {
		const { render, files } = await setup();
		const thirdCycle = (used: number) => files.write('drawings/rounds.json', JSON.stringify({ figures: { '1': { cycle: 3, rounds: Array.from({ length: used }, (_, index) => ({ round: index + 1, png: `review/FIG-1.cycle-3.round-${index + 1}.png`, seen: true })) } } }));
		await thirdCycle(3);
		const exhausted = await render({ figure: 1, scene });
		const exhaustedNewCycle = await render({ figure: 1, scene, newCycle: true });
		await thirdCycle(1);
		const fourthCycle = await render({ figure: 1, scene, newCycle: true });
		await files.delete('drawings/rounds.json');
		for (const round of [1, 2, 3]) {
			await files.write(`drawings/review/FIG-1.cycle-3.round-${round}.png`, 'png');
		}
		const roundsFileGone = await render({ figure: 1, scene, newCycle: true });
		const hard = { ok: false, reason: 'FIG. 1 used 3 review cycles; a person must clear it: drawings reset-rounds hinge 1' };
		expect({ exhausted, exhaustedNewCycle, fourthCycle, roundsFileGone }).toEqual({ exhausted: hard, exhaustedNewCycle: hard, fourthCycle: hard, roundsFileGone: hard });
	});

	it('reset-rounds clears the entry of one Figure and its review renders, and keeps the other Figures', async () => {
		const { files, read } = await setup();
		await files.write('drawings/rounds.json', JSON.stringify({ figures: {
			'1': { cycle: 3, rounds: [1, 2].map(round => ({ round, png: `review/FIG-1.cycle-3.round-${round}.png`, seen: true })) },
			'2': [{ round: 1, png: 'review/FIG-2.round-1.png', seen: false }],
		} }));
		for (const name of ['FIG-1.round-1.png', 'FIG-1.cycle-3.round-1.png', 'FIG-1.cycle-3.round-2.png', 'FIG-2.round-1.png']) {
			await files.write(`drawings/review/${name}`, 'png');
		}
		const figure = { number: 1, key: '1' };
		const cleared = await resetReviewRoundsOp(files, figure);
		expect({
			cleared,
			again: await resetReviewRoundsOp(files, figure),
			review: await files.listFiles('drawings/review'),
			rounds: JSON.parse(await read('drawings/rounds.json') ?? '{}'),
			state: (await readReviewState(files, figure)).state,
		}).toEqual({
			cleared: { cycle: 3, rounds: 2, deleted: ['drafting/hinge/drawings/review/FIG-1.cycle-3.round-1.png', 'drafting/hinge/drawings/review/FIG-1.cycle-3.round-2.png', 'drafting/hinge/drawings/review/FIG-1.round-1.png'] },
			again: { cycle: 0, rounds: 0, deleted: [] },
			review: ['FIG-2.round-1.png'],
			rounds: { figures: { '2': { cycle: 1, rounds: [{ round: 1, png: 'review/FIG-2.round-1.png', seen: false }] } } },
			state: { cycle: 1, used: 0 },
		});
	});

	it('renders a 3D scene: writes the source, the SVG and the review render, and records the round with seen', async () => {
		const { render, read, files } = await setup();
		const first = await render({ figure: 1, scene });
		const second = await render({ figure: 1, scene, seen: false });
		const png = await files.readBytes('drawings/review/FIG-1.round-2.png');
		expect({
			first: withoutBytes(first),
			second: withoutBytes(second),
			drawings: await files.listFiles('drawings'),
			review: await files.listFiles('drawings/review'),
			pngSignature: [...(png ?? []).slice(1, 4)].map(code => String.fromCharCode(code)).join(''),
			sourceFigure: JSON.parse(await read('drawings/FIG-1.scene.json') ?? '{}').figure,
			svgStart: (await read('drawings/FIG-1.svg'))?.slice(0, 4),
			rounds: JSON.parse(await read('drawings/rounds.json') ?? '{}'),
		}).toMatchSnapshot();
	}, KERNEL_TIMEOUT);

	it('renders a flowchart from an approved method claim', async () => {
		const { render, read } = await setup();
		const result = await render({ figure: 2, flowchart: { fromClaim: 2 } });
		expect({ result: withoutBytes(result), source: JSON.parse(await read('drawings/FIG-2.scene.json') ?? '{}') }).toMatchSnapshot();
	}, KERNEL_TIMEOUT);
});

describe('buildDrawingSetOp', () => {
	it('refuses with no Figure, on a proposed part, on a figure-list Error and on a coverage gap', async () => {
		const withFigure = async (changes: Record<string, string>) => {
			const run = await setup({ ...matter, ...changes });
			await run.files.write('drawings/FIG-1.svg', '<svg/>');
			await run.files.write('drawings/FIG-2.svg', '<svg/>');
			return buildDrawingSetOp(run.files);
		};
		expect({
			noFigure: await buildDrawingSetOp((await setup()).files),
			proposed: await withFigure({ 'figures.md': `${figures}- 8: spring (proposed from sketches/sketch-1.png)\n` }),
			epoLetter: await withFigure({ 'feature-list.md': featureList.replace('office: US', 'office: EPO'), 'figures.md': figures.replace('numerals: even', 'numerals: even\npageSize: letter') }),
			coverageGap: await withFigure({ 'figures.md': figures.replace('- 10: housing [F1]', '- 10: housing') }),
		}).toMatchSnapshot();
	});

	it('refuses on an open Figure Error and builds once findings.md waives it', async () => {
		const { render, files, read } = await setup();
		await render({ figure: 1, scene });
		await files.write('figures.md', figures.replace('- 12: top face\n', '').split('## FIG. 2')[0]);
		const refused = await buildDrawingSetOp(files);
		await files.write('findings.md', '# Findings\n\n## Errors\n\n- `numeral-not-allowed` (FIG-1.scene.json): Numeral 12 is not in the figures list.\n  - Waived: The top face is named in the description only.\n');
		const built = await buildDrawingSetOp(files);
		const receipt = await read('drawings/drawings-compliance.md') ?? '';
		expect({
			refused,
			built: built.ok,
			receiptRow: receipt.split('\n').find(line => line.startsWith('| numeral-not-allowed')),
		}).toMatchSnapshot();
	}, KERNEL_TIMEOUT);

	it('refuses a set with a Figure figures.md names but nobody drew, expanding a range heading', async () => {
		const { render, files } = await setup({ ...matter, 'figures.md': `${figures}\n## FIGS. 3 to 5\n\n- 20: frame\n` });
		await render({ figure: 1, scene });
		expect({ result: await buildDrawingSetOp(files), drawings: await files.listFiles('drawings') }).toEqual({
			result: { ok: false, reason: '`figures-missing`: FIG. 2–5 of drafting/hinge/figures.md are not drawn (37 CFR 1.84(p)(5); OJ EPO 2025 A49 Art. 1(2)(i) (every Figure the description names is in the Drawing Set)). Render each with render_figure first. To review the Figures drawn so far, build with the partial option (`partial: true`; CLI `--partial`): the receipt then starts with "INCOMPLETE SET" and the Filing Manifest is not changed.' },
			drawings: ['FIG-1.scene.json', 'FIG-1.svg', 'rounds.json'],
		});
	}, KERNEL_TIMEOUT);

	it('builds a partial set for review: keeps the FIG label, marks the receipt INCOMPLETE SET and leaves the Filing Manifest', async () => {
		const { render, read, files } = await setup({ ...matter, 'figures.md': `${figures}\n## FIGS. 3 to 5\n\n- 20: frame\n` });
		const rendered = await render({ figure: 2, flowchart: { fromClaim: 2 } });
		await files.write('draft-application.md', '---\noffice: US\n---\n# Housing\n\n## CLAIMS\n\n1. A housing comprising a top face.\n');
		await files.write('filing-manifest.md', 'manifest of the export');
		const result = await buildDrawingSetOp(files, { partial: true });
		const receipt = await read('drawings/drawings-compliance.md') ?? '';
		expect({
			stillToDraw: rendered.ok ? rendered.text.split('\n')[1] : rendered.reason,
			result: result.ok ? { text: result.text.split('\n').slice(0, 2), missing: result.missing, manifestUpdated: result.manifestUpdated } : result,
			figLabels: [...(await read('drawings/sheet-1.svg') ?? '').matchAll(/class="fig-label"[^>]*>(?<label>[^<]*)</g)].map(match => match.groups?.label),
			receiptStart: receipt.split('\n').slice(0, 3),
			receiptRows: receipt.split('\n').filter(line => /^\| (figures-missing|single-figure-no-label|figure-labels) /.test(line)),
			manifest: await read('filing-manifest.md'),
		}).toMatchSnapshot();
	}, KERNEL_TIMEOUT);

	it('lays out the Figures, writes the sheets, the PDF and the receipt, and updates the Filing Manifest', async () => {
		const { render, read, files } = await setup();
		await render({ figure: 1, scene });
		await render({ figure: 2, flowchart: { fromClaim: 2 }, seen: false });
		await files.write('draft-application.md', '---\noffice: US\n---\n# Housing\n\n## DETAILED DESCRIPTION\n\nThe housing 10 has a top face 12.\n\n## CLAIMS\n\n1. A housing comprising a top face.\n\n## ABSTRACT\n\nA housing.\n');
		await files.write('filing-manifest.md', 'old manifest');
		await files.write('drawings/sheet-9.svg', '<svg/>');
		const result = await buildDrawingSetOp(files);
		const pdf = Buffer.from(await files.readBytes('drawings/drawings.pdf') ?? []).toString('latin1');
		expect({
			result: result.ok ? { text: result.text, sheets: result.sheets, pageSize: result.pageSize, manifestUpdated: result.manifestUpdated } : result,
			drawings: await files.listFiles('drawings'),
			review: await files.listFiles('drawings/review'),
			pdfHeader: pdf.slice(0, 8),
			receipt: (await read('drawings/drawings-compliance.md'))?.replace(/\d{4}-\d\d-\d\d/, '<date>'),
			manifestSheets: (await read('filing-manifest.md'))?.split('\n').filter(line => /drawing sheets/i.test(line)),
		}).toMatchSnapshot();
	}, KERNEL_TIMEOUT);
});

describe('coverage and numeral checks at build', () => {
	it('with no Draft Outline and no draft, the receipt rows figure-coverage and numeral-not-drawn show not-checked (#804, #802)', async () => {
		const flowchartOnly = `---\nnumerals: even\n---\n## FIG. 2\n\n- 2: measuring a cell temperature [F2]\n- 4: comparing the cell temperature\n- 6: opening a coolant valve\n`;
		const { render, read, files } = await setup({ 'feature-list.md': featureList, 'claims.md': claims, 'figures.md': flowchartOnly });
		await render({ figure: 2, flowchart: { fromClaim: 2 } });
		const result = await buildDrawingSetOp(files);
		const receipt = await read('drawings/drawings-compliance.md') ?? '';
		expect({
			result: result.ok ? result.text.split('\n').slice(1, 3) : result,
			rows: receipt.split('\n').filter(line => /^\| (figure-coverage|numeral-not-drawn|us-keywords-only|numeral-set) /.test(line)),
		}).toMatchSnapshot();
	}, KERNEL_TIMEOUT);

	it('refuses the D7 pipe-clamp set on numeral 10, cited in the description for FIG. 1 and FIG. 2 and drawn in no Figure; builds once the attorney waives it (#802)', async () => {
		const fixture = (name: string) => readFileSync(path.join(__dirname, `fixtures/pipe-clamp.${name}`), 'utf8');
		const { render, read, files } = await setup({ 'feature-list.md': fixture('feature-list.md'), 'figures.md': pipeClampFigures, 'draft-application.md': fixture('draft-application.md') });
		await files.write('drawings/FIG-1.svg', fixture('FIG-1.svg'));
		await files.write('drawings/FIG-2.svg', fixture('FIG-2.svg'));
		await render({ figure: 3, flowchart: { steps: pipeClampSteps } });
		const refused = await buildDrawingSetOp(files);
		await files.write('findings.md', '# Findings\n\n## Errors\n\n- `numeral-not-drawn` (draft-application.md, line 42): Numeral 10 ("pipe clamp") is cited.\n  - Waived: The whole clamp gets numeral 10 in FIG. 1 in the next render.\n');
		const built = await buildDrawingSetOp(files);
		const receipt = await read('drawings/drawings-compliance.md') ?? '';
		expect({
			refused,
			built: built.ok ? built.text.split('\n').slice(1, 3) : built,
			rows: receipt.split('\n').filter(line => /^\| (numeral-not-drawn|figure-coverage|figure-parts-not-drawn) /.test(line)),
		}).toMatchSnapshot();
	}, KERNEL_TIMEOUT);
});

describe('figure-parts-not-drawn', () => {
	it('names the numerals figures.md lists for a Figure but the Figure does not draw, in the render text and as a receipt Note (live FIG. 2)', async () => {
		const quickRelease: DrawingScene = JSON.parse(readFileSync(path.join(__dirname, '../../kernel/test/fixtures/quick-release-section.scene.json'), 'utf8'));
		const { render, read, files } = await setup({ 'feature-list.md': featureList, 'figures.md': readFileSync(path.join(__dirname, 'fixtures/quick-release.figures.md'), 'utf8') });
		const rendered = await render({ figure: 2, scene: quickRelease });
		const result = await buildDrawingSetOp(files, { partial: true });
		const receipt = await read('drawings/drawings-compliance.md') ?? '';
		expect({
			renderLines: rendered.ok ? rendered.text.split('\n').filter(line => /lists but does not draw|Draw each part/.test(line)) : rendered.reason,
			buildLines: result.ok ? result.text.split('\n').filter(line => /not drawn \(Note|does not draw/.test(line)) : result.reason,
			pageSize: result.ok ? result.pageSize : undefined,
			receiptRow: receipt.split('\n').find(line => line.startsWith('| figure-parts-not-drawn')),
		}).toMatchSnapshot();
	}, KERNEL_TIMEOUT);
});

describe('proposeFigurePartOp', () => {
	it('refuses a numeral already used and a numeral outside the scheme', async () => {
		const { files, read } = await setup();
		const hundreds = await setup({ ...matter, 'figures.md': figures.replace('numerals: even', 'numerals: hundreds') });
		expect({
			used: await proposeFigurePartOp(files, { figure: 1, part: 'lid', numeral: '12' }),
			odd: await proposeFigurePartOp(files, { figure: 1, part: 'lid', numeral: '13' }),
			hundreds: await proposeFigurePartOp(hundreds.files, { figure: 1, part: 'lid', numeral: '204' }),
			figuresUnchanged: await read('figures.md') === figures,
		}).toEqual({
			used: { ok: false, reason: 'Numeral 12 is already used for "top face" (drafting/hinge/figures.md, line 7). One numeral names one part.' },
			odd: { ok: false, reason: 'Numeral 13 is odd; figures.md uses `numerals: even`.' },
			hundreds: { ok: false, reason: 'Numeral 204 does not start with 1; figures.md uses `numerals: hundreds`, so a part first drawn in FIG. 1 takes 102 to 198.' },
			figuresUnchanged: true,
		});
	});

	it('writes a proposed line with the next numeral, copies the sketch once, and adds a missing figure heading', async () => {
		const { files, read } = await setup();
		const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
		const first = await proposeFigurePartOp(files, { figure: 1, part: 'bracket', features: ['f1'], sketch: { name: 'bracket sketch.png', bytes } });
		const again = await proposeFigurePartOp(files, { figure: 3, part: 'spring', sketch: { name: 'drafting/hinge/sketches/bracket-sketch.png', bytes } });
		expect({
			first,
			again,
			figures: await read('figures.md'),
			sketches: await files.listFiles('sketches'),
			sketch: [...await files.readBytes('sketches/bracket-sketch.png') ?? []],
		}).toMatchSnapshot();
	});
});
