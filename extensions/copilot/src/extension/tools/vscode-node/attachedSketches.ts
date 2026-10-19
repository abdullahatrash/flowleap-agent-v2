/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { basename } from '../../../util/vs/base/common/path';
import { URI } from '../../../util/vs/base/common/uri';
import { ChatReferenceBinaryData } from '../../../vscodeTypes';
import { sameBytes, SKETCH_EXTENSIONS, sketchFileName } from '../../drawings/common/drawingFiles';
import { MatterFiles } from '../../drawings/node/ops/matterFiles';
import { IBuildPromptContext } from '../../prompt/common/intents';

/** One image attached to the chat request. */
export interface AttachedImage {
	/** The names the attachment goes by in the request. */
	readonly names: readonly string[];
	/** The file name the sketch is stored under. */
	readonly fileName: string;
	readonly mimeType?: string;
	readonly bytes: () => Promise<Uint8Array>;
}

/**
 * The images attached to the chat request a tool call belongs to: a pasted or dropped image, or
 * an image file of the workspace. The drawing tools read `promptContext` in `resolveInput`.
 */
export function attachedImages(promptContext: IBuildPromptContext | undefined, fileSystemService: IFileSystemService): AttachedImage[] {
	const images: AttachedImage[] = [];
	for (const variable of promptContext?.chatVariables ?? []) {
		const value = variable.value;
		const names = [variable.originalName, variable.uniqueName, variable.reference.name].filter(Boolean);
		if (value instanceof ChatReferenceBinaryData && value.mimeType.startsWith('image/')) {
			const reference = value.reference ? basename(value.reference.path) : undefined;
			images.push({ names: reference ? [...names, reference] : names, fileName: reference ?? variable.originalName, mimeType: value.mimeType, bytes: async () => value.data() });
		} else if (URI.isUri(value) && SKETCH_EXTENSIONS.test(value.path)) {
			images.push({ names: [...names, basename(value.path)], fileName: basename(value.path), bytes: () => fileSystemService.readFile(value, true) });
		}
	}
	return images;
}

/**
 * Copies the attached images to `sketches/` of the matter (PRD 0023, slice D5), named
 * `FIG-<figure>-<date>-<k>.<ext>` with `k` the next free number. An image whose bytes are in
 * `sketches/` already is not copied again. Returns the matter-relative paths of the files written.
 */
export async function copyAttachedSketches(files: MatterFiles, images: readonly AttachedImage[], figure: string, date: string): Promise<string[]> {
	const names = await files.listFiles('sketches');
	const kept: Uint8Array[] = [];
	for (const name of names) {
		const bytes = await files.readBytes(`sketches/${name}`);
		if (bytes) {
			kept.push(bytes);
		}
	}
	const copied: string[] = [];
	let next = 1;
	for (const image of images) {
		const bytes = await image.bytes();
		if (kept.some(existing => sameBytes(existing, bytes))) {
			continue;
		}
		const extension = sketchFileName(image.fileName, image.mimeType).split('.').pop();
		let name: string;
		do {
			name = `FIG-${figure}-${date}-${next++}.${extension}`;
		} while (names.includes(name));
		await files.write(`sketches/${name}`, bytes);
		names.push(name);
		kept.push(bytes);
		copied.push(`sketches/${name}`);
	}
	return copied;
}
