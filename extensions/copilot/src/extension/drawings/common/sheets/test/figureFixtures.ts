/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { FigureInput } from '../sheetLayout';

/**
 * A synthetic Figure SVG in the Figure writer's format: millimetre root, a white background, an
 * outline at 0.4 mm, one numeral at 4.5 mm font size (3.22 mm digits) with its lead line.
 */
export function figureSvg(number: number, width: number, height: number, options: { kind?: string; legend?: string; fontSize?: number } = {}): string {
	const fontSize = options.fontSize ?? 4.5;
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" data-figure="${number}"${options.kind ? ` data-kind="${options.kind}"` : ''}>`,
		`<rect width="${width}" height="${height}" fill="#fff"/>`,
		`<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">`,
		`<path class="edge" stroke-width="0.4" d="M10 10 L${width - 10} 10 L${width - 10} ${height - 10} L10 ${height - 10} Z"/>`,
		`<path class="hidden" stroke-width="0.2" stroke-dasharray="1.5 1" d="M10 ${height / 2} L${width - 10} ${height / 2}"/>`,
		`<path class="lead" data-numeral="12" stroke-width="0.2" d="M${width - 8} 6 C${width - 6} 8 ${width - 10} 9 ${width - 10} 12"/>`,
		`</g>`,
		`<text class="numeral" data-numeral="12" x="${width - 5}" y="5" font-size="${fontSize}" font-family="Liberation Sans, Arial, Helvetica, sans-serif" text-anchor="middle" fill="#000">12</text>`,
		options.legend ? `<text x="${width / 2}" y="${height / 2 - 2}" font-size="${fontSize}" text-anchor="middle" fill="#000">${options.legend}</text>` : '',
		`</svg>`,
	].filter(line => line.length > 0).join('\n');
}

/** A Figure input for {@link figureSvg}. */
export function figure(number: number, width: number, height: number, partial?: string): FigureInput {
	return { number, partial, svg: figureSvg(number, width, height) };
}
