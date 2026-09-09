/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const { compileFunction, constants } = require('node:vm');

// Exercise emitted CommonJS code: testing the TS source with an ESM-aware test runner would
// hide a compiler regression that turns import(pdf.mjs) into require(pdf.mjs).
async function loadExtractor() {
	const filename = path.resolve(__dirname, '../out/pdfTextExtractor.js');
	const nativeRequire = createRequire(filename);
	const module = { exports: {} };
	const vscode = {
		workspace: { fs: { readFile: async uri => new Uint8Array(await fs.readFile(uri.fsPath)) } },
		Uri: {
			file: file => ({ fsPath: file, toString: () => pathToFileURL(file).href }),
			joinPath: (uri, ...segments) => vscode.Uri.file(path.join(uri.fsPath, ...segments)),
		},
	};
	const evaluate = compileFunction(await fs.readFile(filename, 'utf8'), ['require', 'module', 'exports'], {
		filename,
		importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
	});
	evaluate(id => id === 'vscode' ? vscode : nativeRequire(id), module, module.exports);
	return { PdfTextExtractor: module.exports.PdfTextExtractor, uri: vscode.Uri.file };
}

/** Build a real text PDF without checking a generated binary into the repository. */
function createPdf() {
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
		...['Dental composite disclosure', 'Filler size 20 to 50 micrometers'].map(text => {
			const stream = `BT /F1 12 Tf 20 250 Td (${text}) Tj ET`;
			return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
		}),
	];
	let pdf = '%PDF-1.4\n';
	const offsets = [0];
	for (const [index, object] of objects.entries()) {
		offsets.push(Buffer.byteLength(pdf));
		pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
	}
	const xref = Buffer.byteLength(pdf);
	pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
	pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
	pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return pdf;
}

test('compiled extractor loads ESM PDF.js and its worker from paths containing spaces, # and %', async t => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-preview # percent% '));
	t.after(() => fs.rm(directory, { recursive: true, force: true }));
	await fs.symlink(path.resolve(__dirname, '../node_modules'), path.join(directory, 'node_modules'), 'junction');
	const pdfPath = path.join(directory, 'disclosure # 1%.pdf');
	await fs.writeFile(pdfPath, createPdf());
	const { PdfTextExtractor, uri } = await loadExtractor();
	const extractor = new PdfTextExtractor(directory, {});
	assert.deepStrictEqual({
		text: await extractor.extractAllText(uri(pdfPath)),
		pageCount: (await extractor.getMetadata(uri(pdfPath))).pageCount,
		secondPage: await extractor.getPageText(uri(pdfPath), 2),
		range: await extractor.extractTextFromPages(uri(pdfPath), 2, 2),
	}, {
		text: '--- Page 1 ---\nDental composite disclosure\n\n--- Page 2 ---\nFiller size 20 to 50 micrometers',
		pageCount: 2,
		secondPage: 'Filler size 20 to 50 micrometers',
		range: '--- Page 2 ---\nFiller size 20 to 50 micrometers',
	});
});
