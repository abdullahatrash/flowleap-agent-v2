/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// A small QR Code encoder (ISO/IEC 18004): byte mode, error correction level
// L or M, versions 1 to 10 (up to 213 bytes at L). Enough for a pairing URL;
// no dependency. Follows the structure of Project Nayuki's reference
// encoder (MIT).

export const enum QrErrorCorrection {
	Low = 0,
	Medium = 1,
}

export interface IQrCode {
	readonly version: number;
	readonly size: number;
	/** `modules[y][x]`, `true` = dark. */
	readonly modules: readonly (readonly boolean[])[];
}

const MAX_VERSION = 10;
// Index 0 unused. Rows: Low, Medium.
const ECC_CODEWORDS_PER_BLOCK = [
	[-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
	[-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
];
const NUM_ERROR_CORRECTION_BLOCKS = [
	[-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
	[-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
];
// Format-information bits of the levels (L = 01, M = 00).
const FORMAT_BITS = [1, 0];

function getBit(value: number, index: number): boolean {
	return ((value >>> index) & 1) !== 0;
}

function numRawDataModules(version: number): number {
	let result = (16 * version + 128) * version + 64;
	if (version >= 2) {
		const numAlign = Math.floor(version / 7) + 2;
		result -= (25 * numAlign - 10) * numAlign - 55;
		if (version >= 7) {
			result -= 36;
		}
	}
	return result;
}

function numDataCodewords(version: number, ecl: QrErrorCorrection): number {
	return Math.floor(numRawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[ecl][version] * NUM_ERROR_CORRECTION_BLOCKS[ecl][version];
}

function gfMultiply(x: number, y: number): number {
	let z = 0;
	for (let i = 7; i >= 0; i--) {
		z = (z << 1) ^ ((z >>> 7) * 0x11d);
		z ^= ((y >>> i) & 1) * x;
	}
	return z & 0xff;
}

function reedSolomonDivisor(degree: number): number[] {
	const result: number[] = new Array(degree - 1).fill(0);
	result.push(1);
	let root = 1;
	for (let i = 0; i < degree; i++) {
		for (let j = 0; j < result.length; j++) {
			result[j] = gfMultiply(result[j], root);
			if (j + 1 < result.length) {
				result[j] ^= result[j + 1];
			}
		}
		root = gfMultiply(root, 0x02);
	}
	return result;
}

function reedSolomonRemainder(data: readonly number[], divisor: readonly number[]): number[] {
	const result: number[] = divisor.map(() => 0);
	for (const b of data) {
		const factor = b ^ (result.shift() as number);
		result.push(0);
		divisor.forEach((coefficient, i) => result[i] ^= gfMultiply(coefficient, factor));
	}
	return result;
}

class QrBuilder {
	readonly size: number;
	readonly modules: boolean[][];
	private readonly _isFunction: boolean[][];

	constructor(readonly version: number, private readonly _ecl: QrErrorCorrection) {
		this.size = version * 4 + 17;
		this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
		this._isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
	}

	private _setFunction(x: number, y: number, dark: boolean): void {
		this.modules[y][x] = dark;
		this._isFunction[y][x] = true;
	}

	drawFunctionPatterns(): void {
		for (let i = 0; i < this.size; i++) {
			this._setFunction(6, i, i % 2 === 0);
			this._setFunction(i, 6, i % 2 === 0);
		}
		this._drawFinder(3, 3);
		this._drawFinder(this.size - 4, 3);
		this._drawFinder(3, this.size - 4);
		const positions = this._alignmentPositions();
		const n = positions.length;
		for (let i = 0; i < n; i++) {
			for (let j = 0; j < n; j++) {
				if (!(i === 0 && j === 0 || i === 0 && j === n - 1 || i === n - 1 && j === 0)) {
					this._drawAlignment(positions[i], positions[j]);
				}
			}
		}
		this.drawFormatBits(0);
		this._drawVersion();
	}

	private _drawFinder(x: number, y: number): void {
		for (let dy = -4; dy <= 4; dy++) {
			for (let dx = -4; dx <= 4; dx++) {
				const dist = Math.max(Math.abs(dx), Math.abs(dy));
				const xx = x + dx;
				const yy = y + dy;
				if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
					this._setFunction(xx, yy, dist !== 2 && dist !== 4);
				}
			}
		}
	}

	private _drawAlignment(x: number, y: number): void {
		for (let dy = -2; dy <= 2; dy++) {
			for (let dx = -2; dx <= 2; dx++) {
				this._setFunction(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
			}
		}
	}

	private _alignmentPositions(): number[] {
		if (this.version === 1) {
			return [];
		}
		const numAlign = Math.floor(this.version / 7) + 2;
		const step = Math.ceil((this.version * 4 + 4) / (numAlign * 2 - 2)) * 2;
		const result = [6];
		for (let pos = this.size - 7; result.length < numAlign; pos -= step) {
			result.splice(1, 0, pos);
		}
		return result;
	}

	drawFormatBits(mask: number): void {
		const data = FORMAT_BITS[this._ecl] << 3 | mask;
		let rem = data;
		for (let i = 0; i < 10; i++) {
			rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
		}
		const bits = (data << 10 | rem) ^ 0x5412;
		for (let i = 0; i <= 5; i++) {
			this._setFunction(8, i, getBit(bits, i));
		}
		this._setFunction(8, 7, getBit(bits, 6));
		this._setFunction(8, 8, getBit(bits, 7));
		this._setFunction(7, 8, getBit(bits, 8));
		for (let i = 9; i < 15; i++) {
			this._setFunction(14 - i, 8, getBit(bits, i));
		}
		for (let i = 0; i < 8; i++) {
			this._setFunction(this.size - 1 - i, 8, getBit(bits, i));
		}
		for (let i = 8; i < 15; i++) {
			this._setFunction(8, this.size - 15 + i, getBit(bits, i));
		}
		this._setFunction(8, this.size - 8, true);
	}

	private _drawVersion(): void {
		if (this.version < 7) {
			return;
		}
		let rem = this.version;
		for (let i = 0; i < 12; i++) {
			rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
		}
		const bits = this.version << 12 | rem;
		for (let i = 0; i < 18; i++) {
			const bit = getBit(bits, i);
			const a = this.size - 11 + i % 3;
			const b = Math.floor(i / 3);
			this._setFunction(a, b, bit);
			this._setFunction(b, a, bit);
		}
	}

	drawCodewords(data: readonly number[]): void {
		let i = 0;
		for (let right = this.size - 1; right >= 1; right -= 2) {
			if (right === 6) {
				right = 5;
			}
			for (let vert = 0; vert < this.size; vert++) {
				for (let j = 0; j < 2; j++) {
					const x = right - j;
					const upward = ((right + 1) & 2) === 0;
					const y = upward ? this.size - 1 - vert : vert;
					if (!this._isFunction[y][x] && i < data.length * 8) {
						this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
						i++;
					}
				}
			}
		}
	}

	applyMask(mask: number): void {
		for (let y = 0; y < this.size; y++) {
			for (let x = 0; x < this.size; x++) {
				let invert: boolean;
				switch (mask) {
					case 0: invert = (x + y) % 2 === 0; break;
					case 1: invert = y % 2 === 0; break;
					case 2: invert = x % 3 === 0; break;
					case 3: invert = (x + y) % 3 === 0; break;
					case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
					case 5: invert = x * y % 2 + x * y % 3 === 0; break;
					case 6: invert = (x * y % 2 + x * y % 3) % 2 === 0; break;
					default: invert = ((x + y) % 2 + x * y % 3) % 2 === 0; break;
				}
				if (!this._isFunction[y][x] && invert) {
					this.modules[y][x] = !this.modules[y][x];
				}
			}
		}
	}

	penalty(): number {
		const size = this.size;
		const m = this.modules;
		let result = 0;
		const line = (get: (i: number) => boolean) => {
			let runColor = get(0);
			let run = 1;
			for (let i = 1; i < size; i++) {
				if (get(i) === runColor) {
					run++;
				} else {
					if (run >= 5) {
						result += 3 + (run - 5);
					}
					runColor = get(i);
					run = 1;
				}
			}
			if (run >= 5) {
				result += 3 + (run - 5);
			}
			// Finder-like 1:1:3:1:1 with four light modules on either side.
			for (let i = 0; i + 10 < size; i++) {
				const pattern = [true, false, true, true, true, false, true];
				const core = pattern.every((v, k) => get(i + k) === v) && [7, 8, 9, 10].every(k => !get(i + k));
				const coreReversed = [0, 1, 2, 3].every(k => !get(i + k)) && pattern.every((v, k) => get(i + 4 + k) === v);
				if (core || coreReversed) {
					result += 40;
				}
			}
		};
		for (let y = 0; y < size; y++) {
			line(x => m[y][x]);
		}
		for (let x = 0; x < size; x++) {
			line(y => m[y][x]);
		}
		for (let y = 0; y < size - 1; y++) {
			for (let x = 0; x < size - 1; x++) {
				const c = m[y][x];
				if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) {
					result += 3;
				}
			}
		}
		let dark = 0;
		for (const row of m) {
			for (const cell of row) {
				if (cell) {
					dark++;
				}
			}
		}
		const total = size * size;
		const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
		result += Math.max(0, k) * 10;
		return result;
	}
}

/**
 * Encodes UTF-8 text as a QR code in byte mode, picking the smallest version
 * that fits and the mask with the lowest penalty. Throws when the text does
 * not fit version 10.
 */
export function encodeQrCode(text: string, ecl: QrErrorCorrection = QrErrorCorrection.Medium): IQrCode {
	const bytes = new TextEncoder().encode(text);
	let version = 1;
	for (; version <= MAX_VERSION; version++) {
		const countBits = version <= 9 ? 8 : 16;
		if (4 + countBits + bytes.length * 8 <= numDataCodewords(version, ecl) * 8) {
			break;
		}
	}
	if (version > MAX_VERSION) {
		throw new Error('Text is too long for this QR encoder.');
	}

	// Bit stream: mode, count, data, terminator, padding.
	const bits: number[] = [];
	const append = (value: number, length: number) => {
		for (let i = length - 1; i >= 0; i--) {
			bits.push((value >>> i) & 1);
		}
	};
	append(0b0100, 4);
	append(bytes.length, version <= 9 ? 8 : 16);
	for (const b of bytes) {
		append(b, 8);
	}
	const capacityBits = numDataCodewords(version, ecl) * 8;
	append(0, Math.min(4, capacityBits - bits.length));
	append(0, (8 - bits.length % 8) % 8);
	for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) {
		append(pad, 8);
	}
	const data: number[] = [];
	for (let i = 0; i < bits.length; i += 8) {
		let value = 0;
		for (let j = 0; j < 8; j++) {
			value = (value << 1) | bits[i + j];
		}
		data.push(value);
	}

	// Error correction and interleaving.
	const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][version];
	const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl][version];
	const rawCodewords = Math.floor(numRawDataModules(version) / 8);
	const numShortBlocks = numBlocks - rawCodewords % numBlocks;
	const shortBlockLen = Math.floor(rawCodewords / numBlocks);
	const divisor = reedSolomonDivisor(blockEccLen);
	const blocks: number[][] = [];
	for (let i = 0, k = 0; i < numBlocks; i++) {
		const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
		k += dat.length;
		const ecc = reedSolomonRemainder(dat, divisor);
		if (i < numShortBlocks) {
			dat.push(0);
		}
		blocks.push(dat.concat(ecc));
	}
	const codewords: number[] = [];
	for (let i = 0; i < blocks[0].length; i++) {
		blocks.forEach((block, j) => {
			if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
				codewords.push(block[i]);
			}
		});
	}

	let best: QrBuilder | undefined;
	let bestPenalty = Infinity;
	for (let mask = 0; mask < 8; mask++) {
		const builder = new QrBuilder(version, ecl);
		builder.drawFunctionPatterns();
		builder.drawCodewords(codewords);
		builder.applyMask(mask);
		builder.drawFormatBits(mask);
		const penalty = builder.penalty();
		if (penalty < bestPenalty) {
			best = builder;
			bestPenalty = penalty;
		}
	}
	return { version, size: best!.size, modules: best!.modules };
}

/**
 * An SVG path (`d` attribute) drawing the dark modules, offset by a quiet
 * zone of `border` modules. Use with `viewBox="0 0 size+2*border size+2*border"`.
 */
export function qrCodeToSvgPath(qr: IQrCode, border = 4): string {
	const parts: string[] = [];
	for (let y = 0; y < qr.size; y++) {
		for (let x = 0; x < qr.size; x++) {
			if (qr.modules[y][x]) {
				parts.push(`M${x + border},${y + border}h1v1h-1z`);
			}
		}
	}
	return parts.join('');
}
