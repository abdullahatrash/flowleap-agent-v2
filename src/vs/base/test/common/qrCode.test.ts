/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { encodeQrCode, QrErrorCorrection, qrCodeToSvgPath } from '../../common/qrCode.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from './utils.js';

// The encoder was checked against an independent decoder (jsQR 1.4.0) for
// versions 1-10 at both levels when it was written; these tests pin the
// structure so a regression shows.
suite('RemoteAccess QrCode', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function finderAt(modules: readonly (readonly boolean[])[], x: number, y: number): boolean {
		for (let dy = -3; dy <= 3; dy++) {
			for (let dx = -3; dx <= 3; dx++) {
				const dist = Math.max(Math.abs(dx), Math.abs(dy));
				if (modules[y + dy][x + dx] !== (dist !== 2)) {
					return false;
				}
			}
		}
		return true;
	}

	test('a pairing URL fits version 6 at level M with three finder patterns', () => {
		const url = 'https://remote.flowleap.co/pair#0f8fad5b-d9cb-469f-a165-70867728950e.abcdefghijklmnopqrstuvwxyz';
		const qr = encodeQrCode(url, QrErrorCorrection.Medium);
		assert.strictEqual(qr.version, 6);
		assert.strictEqual(qr.size, 41);
		assert.strictEqual(qr.modules.length, 41);
		assert.ok(finderAt(qr.modules, 3, 3));
		assert.ok(finderAt(qr.modules, qr.size - 4, 3));
		assert.ok(finderAt(qr.modules, 3, qr.size - 4));
		assert.strictEqual(qr.modules[qr.size - 8][8], true, 'dark module');
	});

	test('versions grow with the text and stop at 10', () => {
		assert.strictEqual(encodeQrCode('a').version, 1);
		assert.strictEqual(encodeQrCode('x'.repeat(150), QrErrorCorrection.Low).version, 7);
		assert.strictEqual(encodeQrCode('x'.repeat(240), QrErrorCorrection.Low).version, 10);
		assert.throws(() => encodeQrCode('x'.repeat(240), QrErrorCorrection.Medium));
	});

	test('the same text gives the same code', () => {
		assert.deepStrictEqual(encodeQrCode('FlowLeap').modules, encodeQrCode('FlowLeap').modules);
	});

	test('svg path draws one square per dark module, offset by the quiet zone', () => {
		const qr = encodeQrCode('a');
		const dark = qr.modules.flat().filter(Boolean).length;
		const path = qrCodeToSvgPath(qr, 4);
		assert.strictEqual(path.split('M').length - 1, dark);
		assert.ok(path.startsWith('M4,4h1v1h-1z'), 'top-left finder module');
	});
});
