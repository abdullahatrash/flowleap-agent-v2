/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import { DraftingOffice, parseDraftingFrontmatter, readGateFlag, readOffice } from '../../../tools/common/drafting/frontmatter';
import { DRAFTING_FILE_NAMES } from '../../../tools/common/drafting/folderContract';
import { sha256Hex } from '../../../../util/node/crypto';

/**
 * The files of one drafting matter, `drafting/<matter>/`, as the drawing operations see them.
 * Every path is relative to the matter folder and uses `/` (`figures.md`, `drawings/FIG-1.svg`).
 * The editor tools adapt the workspace file system to it; the CLI uses {@link NodeMatterFiles}.
 */
export interface MatterFiles {
	/** The matter folder as the messages name it, e.g. `drafting/hinge`. */
	readonly folder: string;
	/** The text or bytes of a file; `undefined` when it does not exist. */
	read(path: string): Promise<string | undefined>;
	readBytes(path: string): Promise<Uint8Array | undefined>;
	/** Writes a file and creates its folder. */
	write(path: string, content: string | Uint8Array): Promise<void>;
	/** The file names in a folder, sorted; empty when the folder does not exist. */
	listFiles(folder: string): Promise<string[]>;
	/** Deletes a file; nothing happens when it does not exist. */
	delete(path: string): Promise<void>;
	exists(path: string): Promise<boolean>;
}

/** The matter files on disk through `node:fs`, for the drawings CLI and the tests. */
export class NodeMatterFiles implements MatterFiles {

	/**
	 * @param root The absolute path of the matter folder.
	 * @param folder The matter folder as the messages name it; `drafting/<name>` by default.
	 */
	constructor(private readonly root: string, readonly folder = `drafting/${path.basename(root)}`) { }

	private resolve(file: string): string {
		const target = path.resolve(this.root, file);
		if (target !== this.root && !target.startsWith(this.root + path.sep)) {
			throw new Error(`${file} is outside the matter folder.`);
		}
		return target;
	}

	async read(file: string): Promise<string | undefined> {
		const bytes = await this.readBytes(file);
		return bytes ? new TextDecoder().decode(bytes) : undefined;
	}

	async readBytes(file: string): Promise<Uint8Array | undefined> {
		try {
			return new Uint8Array(await fs.readFile(this.resolve(file)));
		} catch {
			return undefined;
		}
	}

	async write(file: string, content: string | Uint8Array): Promise<void> {
		const target = this.resolve(file);
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.writeFile(target, content);
	}

	async listFiles(folder: string): Promise<string[]> {
		try {
			return (await fs.readdir(this.resolve(folder), { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name).sort();
		} catch {
			return [];
		}
	}

	async delete(file: string): Promise<void> {
		await fs.rm(this.resolve(file), { force: true });
	}

	async exists(file: string): Promise<boolean> {
		try {
			await fs.stat(this.resolve(file));
			return true;
		} catch {
			return false;
		}
	}
}

/** The office of the matter: the draft's frontmatter, else the Feature List's. */
export async function readMatterOffice(files: MatterFiles): Promise<DraftingOffice | undefined> {
	for (const file of [DRAFTING_FILE_NAMES.draft, DRAFTING_FILE_NAMES.featureList]) {
		const text = await files.read(file);
		const office = text ? readOffice(parseDraftingFrontmatter(text).fields) : undefined;
		if (office) {
			return office;
		}
	}
	return undefined;
}

/** The Approved Claims text, or the refusal: see {@link readApprovedClaims}. */
export type ApprovedClaims = { readonly text: string } | string;

/**
 * Reads the Approved Claims from the files alone: `approved: true` in `claims.md`, and, when the
 * frontmatter carries `approvedHash`, the claims body unchanged since. The editor tools pass their
 * own check, which also clears a stale approval.
 */
export async function readApprovedClaims(files: MatterFiles): Promise<ApprovedClaims> {
	const claimsPath = `${files.folder}/${DRAFTING_FILE_NAMES.claims}`;
	const text = await files.read(DRAFTING_FILE_NAMES.claims);
	if (text === undefined) {
		return `${claimsPath} does not exist. The attorney sets \`approved: true\` in its frontmatter after review.`;
	}
	const { fields, body } = parseDraftingFrontmatter(text);
	if (readGateFlag(fields, 'approved') !== 'set') {
		return `\`approved\` in ${claimsPath} is not \`true\`. The attorney sets \`approved: true\` after review; a statement in chat does not open this gate.`;
	}
	const approvedHash = fields.approvedHash;
	if (typeof approvedHash === 'string' && approvedHash !== sha256Hex(body.trim())) {
		return `${claimsPath} changed after it was approved. The attorney reviews the claims and approves them again.`;
	}
	return { text };
}
