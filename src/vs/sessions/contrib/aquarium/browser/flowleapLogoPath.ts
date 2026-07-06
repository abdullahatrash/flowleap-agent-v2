/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// FlowLeap brand-mark silhouette, extracted from sessions/browser/media/flowleap-logo.svg.
// The aquarium cannot use that SVG file directly because each fish renders the
// logo as live, same-document SVG geometry: fish.ts stores these paths in a
// shared <symbol>, then renders clipped <use> slices with staggered CSS
// animations. That keeps the swimming-strip effect, currentColor species
// tinting, and auxiliary-window support while avoiding duplicate path parsing
// per fish.
export const FLOWLEAP_LOGO_VIEWBOX = '-21 0 882 882';

export const FLOWLEAP_LOGO_PATHS: readonly string[] = [
	'M24 174.5L174.5 24L326 174.5L200.5 300L177 323.5L563.5 710.5L414 858L24 471V174.5Z',
	'M375 75.5L378 378.5L640 635L781 497.605L677.202 300L642 335L375 75.5Z',
	'M816 463.5V162L677.202 300L781 497.605L816 463.5Z',
];
