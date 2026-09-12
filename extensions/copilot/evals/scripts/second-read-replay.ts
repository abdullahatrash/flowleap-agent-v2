/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Offline replay of the second-read diagnostic.
 *
 * Runs the SAME request building and judge prompt the extension runs, but over prior-art reports
 * already on disk, so the diagnostic's usefulness can be measured before anything depends on it.
 * The coverage rows are recovered from the saved Markdown and the passages from the report's
 * `*.evidence.json` companion.
 *
 * Run: OPENROUTER_API_KEY=... npx tsx evals/scripts/second-read-replay.ts [report.md ...]
 *      npx tsx evals/scripts/second-read-replay.ts --help
 *
 * Nothing here writes into a report or into the extension's state; it prints a per-report summary
 * and writes the verdicts as JSON for a human to adjudicate.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
	buildSecondReadRequests,
	parseSecondReadVerdicts,
	SecondReadRequest,
	SecondReadResult,
	SecondReadReview,
	SecondReadRow,
	SecondReadSnapshot,
	secondReadPrompt,
	summarizeSecondRead,
} from '../../src/extension/tools/common/patentSecondRead';

const DEFAULT_MODEL = 'anthropic/claude-sonnet-5';
const DEFAULT_OUT = 'evals/output/second-read/';
const DEFAULT_GLOB = path.join(process.env.HOME ?? '~', 'FlowLeap Projects', '*', 'outputs', 'prior-art-review.md');
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

const HELP = `Second-read replay — judge saved prior-art reports with the extension's own judge prompt.

Usage: npx tsx evals/scripts/second-read-replay.ts [report.md ...] [options]

  <report.md>     One or more report paths; a path may contain * wildcards.
                  Default: "${DEFAULT_GLOB}"
  --model <id>    OpenRouter model id. Default: ${DEFAULT_MODEL}
  --out <dir>     Where the per-report verdict files are written. Default: ${DEFAULT_OUT}
  --dry-run       Parse the reports and report what would be judged; no model call, no output file.
  --help          Print this and exit.

Requires OPENROUTER_API_KEY (or EVAL_API_KEY) in the environment. Every report row that claims
disclosure costs one model call, so point it at a few reports first.`;

interface Options {
	readonly patterns: readonly string[];
	readonly model: string;
	readonly out: string;
	readonly dryRun: boolean;
}

/** Minimal argument reader; the script takes positional paths plus two flags. */
function readOptions(argv: readonly string[]): Options | undefined {
	const patterns: string[] = [];
	let model = DEFAULT_MODEL;
	let out = DEFAULT_OUT;
	let dryRun = false;
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === '--help' || argument === '-h') { return undefined; }
		else if (argument === '--model') { model = argv[++index] ?? DEFAULT_MODEL; }
		else if (argument === '--out') { out = argv[++index] ?? DEFAULT_OUT; }
		else if (argument === '--dry-run') { dryRun = true; }
		else { patterns.push(argument); }
	}
	return { patterns: patterns.length ? patterns : [DEFAULT_GLOB], model, out, dryRun };
}

/** Expand `*` wildcards one path segment at a time; no dependency, no `**`. */
function expand(pattern: string): string[] {
	if (!pattern.includes('*')) { return fs.existsSync(pattern) ? [pattern] : []; }
	const segments = pattern.split(path.sep).filter((segment, index) => segment.length > 0 || index === 0);
	let candidates = [pattern.startsWith(path.sep) ? path.sep : '.'];
	for (const segment of segments) {
		if (!segment || segment === '.') { continue; }
		if (!segment.includes('*')) {
			candidates = candidates.map(candidate => path.join(candidate, segment)).filter(candidate => fs.existsSync(candidate));
			continue;
		}
		const matcher = new RegExp('^' + segment.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
		candidates = candidates.flatMap(candidate => {
			try {
				return fs.readdirSync(candidate).filter(name => matcher.test(name)).map(name => path.join(candidate, name));
			} catch {
				return [];
			}
		});
	}
	return candidates.sort();
}

/** Split a Markdown table row into cells, honouring the `\|` the renderer escapes into them. */
function cells(line: string): string[] {
	return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
}

/** Undo the label escaping `patentCitationLink` applies to an anchor. */
function unescapeLabel(label: string): string {
	return label.replace(/\\([\\[\]])/g, '$1');
}

/**
 * Recover the coverage rows from a saved report: a `### <feature>` heading, the
 * `**<kind> · <importance> · <status>**` line under it, and that row's element table.
 */
export function parseReportCoverage(markdown: string): SecondReadReview {
	const lines = markdown.split(/\r?\n/);
	const coverage: SecondReadRow[] = [];
	let feature: string | undefined;
	let status: string | undefined;
	let elements: { element: string; anchor?: string; disclosedBy?: string }[] = [];
	let inElementTable = false;
	const flush = () => {
		if (feature !== undefined && status !== undefined) { coverage.push({ feature, status, elements }); }
		feature = undefined;
		status = undefined;
		elements = [];
		inElementTable = false;
	};
	for (const line of lines) {
		if (line.startsWith('### ')) {
			flush();
			feature = line.slice(4).trim().replace(/\\\|/g, '|');
			continue;
		}
		if (line.startsWith('## ')) { flush(); continue; }
		if (feature === undefined) { continue; }
		const header = /^\*\*(.+?)\*\*$/.exec(line.trim());
		if (header && status === undefined) {
			status = header[1].split('·').map(part => part.trim())[2];
			continue;
		}
		if (/^\|\s*Element\s*\|/.test(line)) { inElementTable = true; continue; }
		if (inElementTable) {
			if (!line.trim().startsWith('|')) { inElementTable = false; continue; }
			const [element, disclosed, source] = cells(line);
			if (/^-+$/.test(element)) { continue; }
			const fragment = /^`(.*)`$/s.exec(disclosed ?? '');
			const anchor = /^\[(.+)\]\(/s.exec(source ?? '');
			elements.push({
				element,
				...(anchor ? { anchor: unescapeLabel(anchor[1]) } : {}),
				...(fragment ? { disclosedBy: fragment[1] } : {}),
			});
		}
	}
	flush();
	return { coverage };
}

/** The newest `<report>.<uuid>.evidence.json` companion beside a report. */
function readSnapshot(report: string): SecondReadSnapshot | undefined {
	const directory = path.dirname(report);
	const prefix = path.basename(report) + '.';
	const companions = fs.readdirSync(directory)
		.filter(name => name.startsWith(prefix) && name.endsWith('.evidence.json'))
		.map(name => path.join(directory, name))
		.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
	if (!companions.length) { return undefined; }
	return JSON.parse(fs.readFileSync(companions[0], 'utf8')) as SecondReadSnapshot;
}

/** One judge call against OpenRouter with the extension's own prompt. */
async function judge(request: SecondReadRequest, model: string, key: string): Promise<SecondReadResult> {
	const response = await fetch(ENDPOINT, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ model, messages: [{ role: 'user', content: secondReadPrompt(request) }], temperature: 0 }),
		signal: AbortSignal.timeout(180000),
	});
	if (!response.ok) {
		return { feature: request.feature, status: request.status, unparsed: `REQUEST FAILED: ${response.status} ${await response.text()}` };
	}
	const body = await response.json() as { choices?: { message?: { content?: string } }[] };
	const text = body.choices?.[0]?.message?.content ?? '';
	const verdicts = parseSecondReadVerdicts(text);
	return { feature: request.feature, status: request.status, ...(verdicts ? { verdicts } : { unparsed: text }) };
}

async function main(): Promise<void> {
	const options = readOptions(process.argv.slice(2));
	if (!options) {
		console.log(HELP);
		return;
	}
	const key = process.env.OPENROUTER_API_KEY || process.env.EVAL_API_KEY;
	if (!key && !options.dryRun) {
		console.error('Set OPENROUTER_API_KEY (or EVAL_API_KEY) to run the replay. Use --help for usage.');
		process.exitCode = 1;
		return;
	}
	const reports = [...new Set(options.patterns.flatMap(expand))];
	if (!reports.length) {
		console.error(`No report matched: ${options.patterns.join(', ')}`);
		process.exitCode = 1;
		return;
	}
	if (!options.dryRun) { fs.mkdirSync(options.out, { recursive: true }); }
	for (const report of reports) {
		const workspace = path.basename(path.dirname(path.dirname(report)));
		const snapshot = readSnapshot(report);
		if (!snapshot) {
			console.log(`${workspace}: skipped (no evidence companion beside ${path.basename(report)}).`);
			continue;
		}
		const requests = buildSecondReadRequests(parseReportCoverage(fs.readFileSync(report, 'utf8')), snapshot);
		if (!requests.length) {
			console.log(`${workspace}: skipped (no supported or partial row lists elements).`);
			continue;
		}
		if (options.dryRun) {
			const elements = requests.flatMap(request => request.elements);
			console.log(`${workspace}: would judge ${requests.length} rows, ${elements.length} elements, ${elements.filter(element => element.passage).length} with a recorded passage.`);
			continue;
		}
		const rows: SecondReadResult[] = [];
		for (const request of requests) {
			rows.push(await judge(request, options.model, key!));
		}
		const summary = summarizeSecondRead(rows);
		const file = path.join(options.out, `${workspace}.json`);
		fs.writeFileSync(file, JSON.stringify({ report, workspace, model: options.model, judgedAt: new Date().toISOString(), rows, summary }, null, 2));
		console.log(`${workspace}: ${summary.elements} elements judged over ${rows.length} rows, ${summary.disagree} disagree, ${summary.unclear} unclear, ${summary.unparsed} unparsed → ${file}`);
		for (const row of rows) {
			for (const verdict of row.verdicts ?? []) {
				if (verdict.verdict === 'agree') { continue; }
				console.log(`  [${verdict.verdict}] ${row.feature} / ${verdict.element}: ${verdict.reason}`);
			}
			if (row.unparsed !== undefined) { console.log(`  [unparsed] ${row.feature}: ${row.unparsed.slice(0, 300)}`); }
		}
	}
}

// Only run main() when invoked as a standalone script (not when imported by a test).
if (typeof require !== 'undefined' && require.main === module) {
	main().catch(error => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
