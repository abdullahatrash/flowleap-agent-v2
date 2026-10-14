/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DraftFinding } from '../../../tools/common/drafting/finding';
import { CAP_HEIGHT_RATIO, DrawingOffice, DrawingPageSize, MIN_GLYPH_HEIGHT, PAGE_SIZES, SHEET_MARGINS, sheetNumberText } from './sheetLayout';
import { applyMatrix, Matrix, matrixScale, parseLength, parseSvg, parseViewBox, SvgNode, walkSvg } from './svgTree';

/**
 * The sheet-level code checks of `docs/research/patent-drawings/01-formal-drawing-rules.md`
 * section 9, each with the rule it applies. The Figure-level checks (lead lines, numeral sets,
 * hatching) come from the Figure writers as Findings and merge into the same receipt.
 */
export const SHEET_CHECKS = {
	'page-size': '37 CFR 1.84(f); OJ EPO 2025 A49 Art. 2(2); PCT Rule 11.5 (A4 for all, Letter for the USPTO only; one size per application)',
	'margins': '37 CFR 1.84(g), (t); OJ EPO 2025 A49 Art. 1(1), Art. 2(5); PCT Rule 11.6(c), 11.7 (top 25, left 25, right 15, bottom 10 mm; nothing in the margin)',
	'no-frame': '37 CFR 1.84(g); OJ EPO 2025 A49 Art. 1(1); PCT Rule 11.6(c) (no frame around the sight)',
	'glyph-height': '37 CFR 1.84(p)(3); OJ EPO 2025 A49 Art. 1(2)(g); PCT Rule 11.13(h) (0.32 cm minimum at sheet scale)',
	'label-larger-than-numerals': '37 CFR 1.84(t), (u)(2); GL A-IX 4.2, 5.2 (FIG labels and sheet numbers larger than the reference signs)',
	'figure-labels': '37 CFR 1.84(u)(1); GL A-IX 5.2; PCT Rule 11.13(k), IP 5.141 ("FIG." / "Fig.", consecutive Arabic numerals, partial views as number plus capital letter)',
	'single-figure-no-label': '37 CFR 1.84(u)(1); GL A-IX 5.2; PCT IP 5.141 (a single Figure is not numbered and carries no "FIG.")',
	'sheet-numbering': '37 CFR 1.84(t); PCT AI Section 207(b)(iii), Rule 11.7 ("n/N"); OJ EPO 2025 A49 Art. 2(5), GL A-IX 4.2 (consecutive integer); centred at the top of the sight',
	'orientation': '37 CFR 1.84(i) (top of a sideways sheet on the right); OJ EPO 2025 A49 Art. 1(2)(h); PCT Rule 11.13(j) (top of the Figures on the left)',
	'text-keywords': '37 CFR 1.84(o); MPEP 507(C); OJ EPO 2025 A49 Art. 1(2)(j); PCT Rule 11.11 (a few short keywords; flowcharts and block diagrams excepted)',
	'no-scale-text': '37 CFR 1.84(k); OJ EPO 2025 A49 Art. 1(2)(c); PCT Rule 11.13(d) (no "actual size" or "scale 1:2")',
	'pdf-format': 'USPTO Patent Center PDF Guidelines; PCT Annex F 3.1.2 (PDF 1.4 to 1.6, fonts embedded, unencrypted, one page per sheet, A4 or Letter)',
	'figures-missing': '37 CFR 1.84(p)(5); OJ EPO 2025 A49 Art. 1(2)(i) (every Figure the description names is in the Drawing Set)',
} as const;

/** A sheet-level check id. */
export type SheetCheckId = keyof typeof SHEET_CHECKS;

/** The result of one code check. Never a verdict on the drawings as a whole. */
export interface CheckResult {
	readonly id: string;
	readonly citation: string;
	readonly result: 'pass' | 'fail' | 'not-checked';
	readonly detail: string;
}

/** A Figure-level Finding from the Figure writers (the drawings engine Finding shape). */
export interface FigureFinding extends DraftFinding {
	readonly citation?: string;
}

/** The review renders the model saw for one Figure, latest last. Empty when no render was seen. */
export interface FigureReviewRecord {
	/** The Figure key, e.g. `1` or `1A`. */
	readonly figure: string;
	readonly rounds: readonly { readonly round: number; readonly png: string }[];
}

/** What a read-back of `drawings.pdf` found. */
export interface PdfFacts {
	readonly version: string;
	readonly pageCount: number;
	readonly fontsEmbedded: boolean;
	readonly encrypted: boolean;
	/** Page sizes in millimetres, in page order. */
	readonly pageSizes: readonly { readonly width: number; readonly height: number }[];
}

/** The Figures the figure list names, for the completeness check and the FIG label rules. */
export interface FigureSetFacts {
	/** The number of Figures the figure list (`figures.md` headings) names. */
	readonly expected: number;
	/** The Figures not drawn, e.g. `FIG. 1, 3–10`; empty when every Figure is drawn. */
	readonly missing: string;
}

/** Everything the receipt records. */
export interface ReceiptInput {
	readonly office: DrawingOffice;
	readonly pageSize: DrawingPageSize;
	/** The sheet SVGs in sheet order. */
	readonly sheets: readonly string[];
	/** The Figure-level checks that ran, rule id to citation; a rule here with no Error Finding passes. */
	readonly figureRules?: Readonly<Record<string, string>>;
	readonly figureFindings?: readonly FigureFinding[];
	readonly reviewRounds: readonly FigureReviewRecord[];
	/** The PDF read-back; absent means the PDF check is recorded as not checked. */
	readonly pdf?: PdfFacts;
	/** The receipt date, `YYYY-MM-DD`. */
	readonly date: string;
	/** The Figures the figure list names; absent means the completeness check is not recorded. */
	readonly figureSet?: FigureSetFacts;
}

interface Box {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

interface SheetText {
	readonly classes: readonly string[];
	readonly content: string;
	/** Font size at sheet scale. */
	readonly font: number;
	readonly box: Box;
	readonly x: number;
	readonly figure?: string;
}

interface SheetFigure {
	readonly key: string;
	readonly kind: string;
	readonly box: Box;
	readonly rotation: number;
}

interface SheetFacts {
	readonly number: number;
	readonly width: number;
	readonly height: number;
	readonly texts: readonly SheetText[];
	readonly figures: readonly SheetFigure[];
	/** Drawn elements outside any Figure, or elements with a `frame` class. */
	readonly frames: readonly string[];
}

/** Advance widths (fraction of the font size) of Liberation Sans and Arial for label characters. */
const ADVANCE: Readonly<Record<string, number>> = { ' ': 0.278, '.': 0.278, '/': 0.278, 'F': 0.611, 'I': 0.278, 'G': 0.778, 'i': 0.222, 'g': 0.556 };

function textWidth(content: string, font: number): number {
	let width = 0;
	for (const char of content) {
		width += ADVANCE[char] ?? (/\d/.test(char) ? 0.556 : /[A-Z]/.test(char) ? 0.667 : 0.556);
	}
	return width * font;
}

function boxOf(matrix: Matrix, points: readonly (readonly [number, number])[]): Box {
	const mapped = points.map(([x, y]) => applyMatrix(matrix, x, y));
	return {
		left: Math.min(...mapped.map(point => point[0])),
		top: Math.min(...mapped.map(point => point[1])),
		right: Math.max(...mapped.map(point => point[0])),
		bottom: Math.max(...mapped.map(point => point[1])),
	};
}

function classesOf(node: SvgNode): string[] {
	return (node.attrs.get('class') ?? '').split(/\s+/).filter(name => name.length > 0);
}

function readSheet(source: string, number: number): SheetFacts {
	const root = parseSvg(source);
	const texts: SheetText[] = [];
	const figures: SheetFigure[] = [];
	const frames: string[] = [];
	walkSvg(root, ({ node, matrix, style, viewport }) => {
		const classes = classesOf(node);
		if (classes.includes('frame')) {
			frames.push(`<${node.name} class="frame">`);
		}
		if (node.name === 'svg') {
			const viewBox = parseViewBox(node.attrs.get('viewBox'));
			if (viewBox) {
				const [x, y, width, height] = viewBox;
				figures.push({
					key: node.attrs.get('data-figure') ?? '?',
					kind: node.attrs.get('data-kind') ?? '3d',
					box: boxOf(matrix, [[x, y], [x + width, y], [x, y + height], [x + width, y + height]]),
					rotation: Math.round(Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI),
				});
			}
			return;
		}
		if (node.name === 'text') {
			const font = (parseLength(style.get('font-size')) ?? 0);
			const x = parseLength(node.attrs.get('x')) ?? 0;
			const y = parseLength(node.attrs.get('y')) ?? 0;
			const width = textWidth(node.text, font);
			const anchor = style.get('text-anchor') ?? 'start';
			const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
			const cap = font * CAP_HEIGHT_RATIO;
			texts.push({
				classes,
				content: node.text.trim(),
				font: font * matrixScale(matrix),
				box: boxOf(matrix, [[left, y - cap], [left + width, y - cap], [left, y + font * 0.21], [left + width, y + font * 0.21]]),
				x: applyMatrix(matrix, x, y)[0],
				figure: viewport?.attrs.get('data-figure'),
			});
			return;
		}
		if (!viewport && node.name !== 'g' && (style.get('stroke') ?? 'none') !== 'none') {
			frames.push(`<${node.name}> with a stroke outside every Figure`);
		} else if (!viewport && ['rect', 'path', 'line', 'polyline', 'polygon'].includes(node.name)) {
			frames.push(`<${node.name}> outside every Figure`);
		}
	});
	return {
		number,
		width: parseLength(root.attrs.get('width')) ?? 0,
		height: parseLength(root.attrs.get('height')) ?? 0,
		texts,
		figures,
		frames,
	};
}

function check(id: SheetCheckId, failures: readonly string[], passDetail: string): CheckResult {
	return { id, citation: SHEET_CHECKS[id], result: failures.length ? 'fail' : 'pass', detail: failures.length ? failures.join('; ') : passDetail };
}

const round2 = (value: number) => value.toFixed(2);

/**
 * Runs the sheet-level checks on the sheet SVGs as written. The checks read the files, so a sheet
 * changed by hand is checked as it is, not as the layout meant it.
 */
export function runSheetChecks(office: DrawingOffice, pageSize: DrawingPageSize, sheetSources: readonly string[], pdf?: PdfFacts, figureSet?: FigureSetFacts): CheckResult[] {
	const sheets = sheetSources.map((source, index) => readSheet(source, index + 1));
	const page = PAGE_SIZES[pageSize];
	const results: CheckResult[] = [];
	const near = (a: number, b: number, tolerance = 0.05) => Math.abs(a - b) <= tolerance;

	const sizeFailures: string[] = [];
	if (pageSize === 'letter' && office !== 'US') {
		sizeFailures.push(`Letter is not accepted by the ${office}`);
	}
	for (const sheet of sheets) {
		if (!near(sheet.width, page.width) || !near(sheet.height, page.height)) {
			sizeFailures.push(`sheet ${sheet.number} is ${round2(sheet.width)} x ${round2(sheet.height)} mm, not ${pageSize} ${page.width} x ${page.height} mm`);
		}
	}
	results.push(check('page-size', sizeFailures, `${sheets.length} sheet(s), all ${pageSize} ${page.width} x ${page.height} mm, short side at the top.`));

	const sight: Box = { left: SHEET_MARGINS.left, top: SHEET_MARGINS.top, right: page.width - SHEET_MARGINS.right, bottom: page.height - SHEET_MARGINS.bottom };
	const outside = (box: Box) => box.left < sight.left - 1e-3 || box.top < sight.top - 1e-3 || box.right > sight.right + 1e-3 || box.bottom > sight.bottom + 1e-3;
	const marginFailures: string[] = [];
	for (const sheet of sheets) {
		for (const figure of sheet.figures) {
			if (outside(figure.box)) {
				marginFailures.push(`sheet ${sheet.number}: Figure ${figure.key} reaches into the margin`);
			}
		}
		for (const text of sheet.texts) {
			if (!text.figure && outside(text.box)) {
				marginFailures.push(`sheet ${sheet.number}: "${text.content}" is in the margin`);
			}
		}
	}
	results.push(check('margins', marginFailures, `Every Figure, label and sheet number is inside the ${round2(sight.right - sight.left)} x ${round2(sight.bottom - sight.top)} mm sight.`));

	results.push(check('no-frame', sheets.flatMap(sheet => sheet.frames.map(frame => `sheet ${sheet.number}: ${frame}`)), 'No frame and no drawn element outside the Figures.'));

	const glyphFailures: string[] = [];
	let smallest = Number.POSITIVE_INFINITY;
	for (const sheet of sheets) {
		for (const text of sheet.texts) {
			const glyph = text.font * CAP_HEIGHT_RATIO;
			smallest = Math.min(smallest, glyph);
			if (glyph < MIN_GLYPH_HEIGHT - 1e-6) {
				glyphFailures.push(`sheet ${sheet.number}: "${text.content}" is ${round2(glyph)} mm high`);
			}
		}
	}
	results.push(check('glyph-height', glyphFailures, `Smallest glyph at sheet scale: ${Number.isFinite(smallest) ? round2(smallest) : '-'} mm (minimum ${MIN_GLYPH_HEIGHT} mm).`));

	const allTexts = sheets.flatMap(sheet => sheet.texts);
	const numeralFont = Math.max(0, ...allTexts.filter(text => text.classes.includes('numeral')).map(text => text.font));
	const sizeTexts = allTexts.filter(text => text.classes.includes('fig-label') || text.classes.includes('sheet-number'));
	results.push(check('label-larger-than-numerals',
		sizeTexts.filter(text => text.font <= numeralFont + 1e-6).map(text => `"${text.content}" is ${round2(text.font)} mm, numerals are up to ${round2(numeralFont)} mm`),
		`Labels and sheet numbers at least ${round2(Math.min(...sizeTexts.map(text => text.font), Number.POSITIVE_INFINITY))} mm; numerals up to ${round2(numeralFont)} mm.`));

	const drawnCount = sheets.reduce((total, sheet) => total + sheet.figures.length, 0);
	const figureCount = Math.max(drawnCount, figureSet?.expected ?? 0);
	const incomplete = !!figureSet?.missing;
	const labels = allTexts.filter(text => text.classes.includes('fig-label')).map(text => text.content);
	if (figureCount === 1) {
		results.push(check('single-figure-no-label', labels.map(label => `the only Figure carries the label "${label}"`), 'One Figure, no FIG label.'));
		results.push({ id: 'figure-labels', citation: SHEET_CHECKS['figure-labels'], result: 'not-checked', detail: 'A single-figure Drawing Set has no labels.' });
	} else {
		results.push({ id: 'single-figure-no-label', citation: SHEET_CHECKS['single-figure-no-label'], result: 'not-checked', detail: `${figureCount} Figures; the rule applies to one.` });
		const pattern = office === 'US' ? /^FIG\. (?<number>\d+)(?<partial>[A-Z])?$/ : /^(?:FIG|Fig)\.? (?<number>\d+)(?<partial>[A-Z])?$/;
		const labelFailures: string[] = [];
		if (labels.length !== drawnCount) {
			labelFailures.push(`${drawnCount} Figures but ${labels.length} labels`);
		}
		const numbers: number[] = [];
		for (const label of labels) {
			const match = pattern.exec(label);
			if (!match) {
				labelFailures.push(`"${label}" does not match the ${office} format`);
			} else {
				numbers.push(Number(match.groups!.number));
			}
		}
		const distinct = [...new Set(numbers)];
		if (incomplete) {
			// A partial build for review: the labels ascend in sheet order; the gaps are the Figures not drawn.
			if (numbers.some((value, index) => index > 0 && value < numbers[index - 1])) {
				labelFailures.push(`numbers ${numbers.join(', ')} do not ascend in sheet order`);
			}
		} else if (distinct.some((value, index) => value !== index + 1) || numbers.some((value, index) => index > 0 && value < numbers[index - 1])) {
			labelFailures.push(`numbers ${numbers.join(', ')} are not consecutive from 1 in sheet order`);
		}
		results.push(check('figure-labels', labelFailures, `${labels.join(', ')}.`));
	}

	const numberFailures: string[] = [];
	const centre = sight.left + (sight.right - sight.left) / 2;
	for (const sheet of sheets) {
		const found = sheet.texts.filter(text => text.classes.includes('sheet-number'));
		const expected = sheetNumberText(office, sheet.number, sheets.length);
		if (found.length !== 1) {
			numberFailures.push(`sheet ${sheet.number} has ${found.length} sheet numbers`);
			continue;
		}
		const [text] = found;
		if (text.content !== expected) {
			numberFailures.push(`sheet ${sheet.number} reads "${text.content}", expected "${expected}"`);
		}
		if (!near(text.x, centre, 0.5) || text.box.top > sight.top + 15) {
			numberFailures.push(`sheet ${sheet.number}: the number is not centred at the top of the sight`);
		}
	}
	results.push(check('sheet-numbering', numberFailures, `${office === 'EPO' ? 'Integers' : '"n/N"'} 1 to ${sheets.length}, centred at the top of the sight.`));

	const sideways = office === 'US' ? 90 : -90;
	const orientationFailures: string[] = [];
	let landscapeSheets = 0;
	for (const sheet of sheets) {
		const rotations = [...new Set(sheet.figures.map(figure => figure.rotation))];
		if (rotations.length > 1) {
			orientationFailures.push(`sheet ${sheet.number} mixes orientations`);
		}
		for (const rotation of rotations) {
			if (rotation !== 0) {
				landscapeSheets++;
				if (rotation !== sideways) {
					orientationFailures.push(`sheet ${sheet.number}: Figure top is turned ${rotation} degrees; the ${office} needs ${sideways} (top on the ${office === 'US' ? 'right' : 'left'})`);
				}
			}
		}
	}
	results.push(check('orientation', orientationFailures, `${sheets.length - landscapeSheets} upright sheet(s), ${landscapeSheets} sideways with the Figure top on the ${office === 'US' ? 'right' : 'left'}.`));

	const wordFailures: string[] = [];
	const scaleFailures: string[] = [];
	for (const sheet of sheets) {
		for (const figure of sheet.figures) {
			const legends = sheet.texts.filter(text => text.figure === figure.key && !text.classes.includes('numeral'));
			for (const legend of legends) {
				if (/actual size|\bscale\s*[\d½:]/i.test(legend.content)) {
					scaleFailures.push(`Figure ${figure.key}: "${legend.content}"`);
				}
			}
			if (figure.kind === 'flowchart' || figure.kind === 'block') {
				continue;
			}
			const words = legends.reduce((total, legend) => total + legend.content.split(/\s+/).filter(word => word.length > 0).length, 0);
			if (words > 3) {
				wordFailures.push(`Figure ${figure.key} has ${words} words of text`);
			}
		}
	}
	results.push(check('text-keywords', wordFailures, 'No Figure has more than 3 words of legend text (flowcharts and block diagrams excepted).'));
	results.push(check('no-scale-text', scaleFailures, 'No scale or "actual size" text.'));

	if (!pdf) {
		results.push({ id: 'pdf-format', citation: SHEET_CHECKS['pdf-format'], result: 'not-checked', detail: 'No PDF read-back was given.' });
	} else {
		const pdfFailures: string[] = [];
		if (!/^1\.[4-6]$/.test(pdf.version)) {
			pdfFailures.push(`PDF version ${pdf.version}`);
		}
		if (!pdf.fontsEmbedded) {
			pdfFailures.push('a font is not embedded');
		}
		if (pdf.encrypted) {
			pdfFailures.push('the PDF is encrypted');
		}
		if (pdf.pageCount !== sheets.length) {
			pdfFailures.push(`${pdf.pageCount} pages for ${sheets.length} sheets`);
		}
		if (pdf.pageSizes.some(size => !near(size.width, page.width, 0.5) || !near(size.height, page.height, 0.5))) {
			pdfFailures.push(`a page is not ${pageSize}`);
		}
		results.push(check('pdf-format', pdfFailures, `PDF ${pdf.version}, ${pdf.pageCount} page(s), fonts embedded, not encrypted.`));
	}
	return results;
}

/** Merges the Figure-level Findings into check rows: a rule fails on an unwaived Error, else passes. */
function figureRows(rules: Readonly<Record<string, string>>, findings: readonly FigureFinding[]): CheckResult[] {
	const ids = [...new Set([...Object.keys(rules), ...findings.map(finding => finding.rule)])];
	return ids.map(id => {
		const own = findings.filter(finding => finding.rule === id);
		const errors = own.filter(finding => finding.severity === 'Error' && !finding.waived);
		const waived = own.filter(finding => finding.waived);
		const citation = rules[id] ?? own.find(finding => finding.citation)?.citation ?? '-';
		const detail = errors.length
			? errors.map(finding => finding.file ? `${finding.file}: ${finding.message}` : finding.message).join('; ')
			: waived.length ? `Waived: ${waived.map(finding => finding.waived!.reason).join('; ')}` : 'No finding.';
		return { id, citation, result: errors.length ? 'fail' : 'pass', detail };
	});
}

function cell(text: string): string {
	return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * Writes `drawings-compliance.md`: every code check with its rule and result, and the review
 * renders the model saw per Figure ("no render seen" when none). The receipt lists checks and
 * results only; it states no verdict on the Drawing Set and the rules a person must judge
 * (01-formal-drawing-rules.md section 10) stay with the attorney.
 */
export function writeDrawingsReceipt(input: ReceiptInput): { readonly markdown: string; readonly checks: readonly CheckResult[] } {
	const completeness: CheckResult[] = input.figureSet
		? [check('figures-missing', input.figureSet.missing ? [`${input.figureSet.missing} not drawn`] : [], `All ${input.figureSet.expected} Figure(s) of the figure list are drawn.`)]
		: [];
	const checks = [...completeness, ...runSheetChecks(input.office, input.pageSize, input.sheets, input.pdf, input.figureSet), ...figureRows(input.figureRules ?? {}, input.figureFindings ?? [])];
	const count = (result: CheckResult['result']) => checks.filter(row => row.result === result).length;
	const lines: string[] = [];
	if (input.figureSet?.missing) {
		lines.push(`INCOMPLETE SET: ${input.figureSet.missing} not drawn`);
		lines.push('');
		lines.push('This partial build is for review only. It is not a Drawing Set to file, and the Filing Manifest was not changed.');
		lines.push('');
	}
	lines.push('# Drawing Set check receipt');
	lines.push('');
	lines.push(`- Office: ${input.office}`);
	lines.push(`- Page size: ${input.pageSize}`);
	lines.push(`- Drawing Sheets: ${input.sheets.length}`);
	lines.push(`- Date: ${input.date}`);
	lines.push(`- Results: ${count('pass')} pass, ${count('fail')} fail, ${count('not-checked')} not checked`);
	lines.push('');
	lines.push('This file lists each code check, the rule it applies and its result. It is not a verdict on the drawings. The rules a person must judge (sufficient views, every claimed feature shown, suitable legends) are not checked here; the attorney reviews them.');
	lines.push('');
	lines.push('## Checks');
	lines.push('');
	lines.push('| Check | Rule | Result | Detail |');
	lines.push('|---|---|---|---|');
	for (const row of checks) {
		lines.push(`| ${cell(row.id)} | ${cell(row.citation)} | ${row.result} | ${cell(row.detail)} |`);
	}
	lines.push('');
	lines.push('## Review rounds');
	lines.push('');
	lines.push('| Figure | Rounds the model saw | Latest render |');
	lines.push('|---|---|---|');
	for (const record of input.reviewRounds) {
		const rounds = [...record.rounds].sort((a, b) => a.round - b.round);
		lines.push(rounds.length
			? `| ${cell(record.figure)} | ${rounds.map(item => item.round).join(', ')} | ${cell(rounds[rounds.length - 1].png)} |`
			: `| ${cell(record.figure)} | no render seen | - |`);
	}
	if (input.reviewRounds.length === 0) {
		lines.push('| - | no render seen | - |');
	}
	lines.push('');
	return { markdown: lines.join('\n'), checks };
}
