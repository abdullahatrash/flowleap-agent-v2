/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Sequencer } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { FileOperationError, FileOperationResult, FileSystemProviderCapabilities, IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ISecretStorageProvider } from '../../../../platform/secrets/common/secrets.js';
import { ISecretStorageCrypto, NetworkError } from './secretStorageCrypto.js';

type Secrets = Record<string, string>;

/**
 * Secret storage of a Hosted Workspace (FlowLeap #547): all secrets are one sealed JSON
 * record in one file of the user data folder, which a Hosted Workspace keeps on the server.
 *
 * - The record is sealed with {@link ISecretStorageCrypto} (AES-GCM with a server-issued key),
 *   so the file on the server is not plaintext.
 * - Every change re-reads the file before it writes, and the file is watched, so two tabs
 *   (or two browsers) on the same workspace do not overwrite each other's secrets.
 * - A failure to get the key (`NetworkError`) never discards the stored secrets.
 */
export class HostedSecretStorageProvider extends Disposable implements ISecretStorageProvider {

	private readonly _onDidChangeSecretExternally = this._register(new Emitter<string>());
	/** A secret was changed by another tab or browser (not by this provider). */
	readonly onDidChangeSecretExternally = this._onDidChangeSecretExternally.event;

	readonly type = 'persisted';

	private readonly writeSequencer = new Sequencer();
	private cache: Promise<Secrets> | undefined;

	constructor(
		private readonly resource: URI,
		private readonly crypto: ISecretStorageCrypto,
		private readonly fileService: IFileService,
		private readonly logService: ILogService,
	) {
		super();

		const watcher = this._register(this.fileService.createWatcher(this.resource, { recursive: false, excludes: [] }));
		this._register(watcher.onDidChange(e => {
			if (e.contains(this.resource)) {
				this.onDidChangeExternally();
			}
		}));
	}

	async get(key: string): Promise<string | undefined> {
		const secrets = await this.getSecrets();
		return secrets[key];
	}

	async keys(): Promise<string[]> {
		return Object.keys(await this.getSecrets());
	}

	set(key: string, value: string): Promise<void> {
		return this.update(secrets => { secrets[key] = value; });
	}

	delete(key: string): Promise<void> {
		return this.update(secrets => { delete secrets[key]; });
	}

	private getSecrets(): Promise<Secrets> {
		if (!this.cache) {
			const cache = this.cache = this.read();
			// Do not keep a failed read (for example the key could not be fetched): try again next time.
			cache.catch(() => {
				if (this.cache === cache) {
					this.cache = undefined;
				}
			});
		}
		return this.cache;
	}

	private update(change: (secrets: Secrets) => void): Promise<void> {
		return this.writeSequencer.queue(async () => {
			// Read the file again: another tab may have changed it since our last read.
			const secrets = await this.read();
			change(secrets);
			const sealed = await this.crypto.seal(JSON.stringify(secrets));
			await this.fileService.writeFile(this.resource, VSBuffer.fromString(sealed), this.fileService.hasCapability(this.resource, FileSystemProviderCapabilities.FileAtomicWrite) ? { atomic: { postfix: '.vsctmp' } } : undefined);
			this.cache = Promise.resolve(secrets);
		});
	}

	private async read(): Promise<Secrets> {
		let content: string;
		try {
			content = (await this.fileService.readFile(this.resource, { atomic: this.fileService.hasCapability(this.resource, FileSystemProviderCapabilities.FileAtomicRead) })).value.toString();
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return {};
			}
			throw error;
		}

		if (!content) {
			return {};
		}

		try {
			const secrets = JSON.parse(await this.crypto.unseal(content));
			return secrets && typeof secrets === 'object' ? secrets : {};
		} catch (error) {
			if (error instanceof NetworkError) {
				throw error; // the key is not reachable now: keep the file, fail this call
			}

			// The file cannot be opened with the current key. Keep it aside instead of overwriting it.
			const unreadable = this.resource.with({ path: `${this.resource.path}.unreadable-${Date.now()}` });
			this.logService.error(`[HostedSecretStorage] cannot unseal ${this.resource.toString()}, moved to ${unreadable.toString()}`, error);
			await this.fileService.move(this.resource, unreadable, true);
			return {};
		}
	}

	private async onDidChangeExternally(): Promise<void> {
		const previous = this.cache;
		if (!previous) {
			return; // nothing read yet, nothing to compare
		}

		let before: Secrets;
		let after: Secrets;
		try {
			before = await previous;
			after = await this.read();
		} catch {
			this.cache = undefined;
			return;
		}

		if (this.cache !== previous) {
			return; // a local change happened meanwhile and is newer
		}
		this.cache = Promise.resolve(after);

		for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
			if (before[key] !== after[key]) {
				this._onDidChangeSecretExternally.fire(key);
			}
		}
	}
}
