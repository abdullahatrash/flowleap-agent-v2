/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Sequencer } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IStorageItemsChangeEvent, IUpdateRequest } from '../../../../base/parts/storage/common/storage.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { StorageScope } from '../../../../platform/storage/common/storage.js';
import { IUserDataProfile } from '../../../../platform/userDataProfile/common/userDataProfile.js';
import { IAnyWorkspaceIdentifier } from '../../../../platform/workspace/common/workspace.js';
import { IUserDataProfileService } from '../../userDataProfile/common/userDataProfile.js';
import { BrowserStorageService, IIndexedDBStorageDatabase } from './storageService.js';

const STATE_FILE_NAME = 'browserState.json';
const SHARED_STATE_FILE_NAME = 'browserState.shared.json';

/**
 * The browser storage (global, profile and workspace state) of a Hosted Workspace (FlowLeap
 * #547). Each scope is one JSON file in the user data folder, which a Hosted Workspace keeps
 * on the server, so a new browser or a browser that cleared its site data gets the same
 * state (selected chat model, chat session list, layout).
 */
export class HostedStorageService extends BrowserStorageService {

	constructor(
		workspace: IAnyWorkspaceIdentifier,
		userDataProfileService: IUserDataProfileService,
		private readonly userRoamingDataHome: URI,
		private readonly workspaceStorageHome: URI,
		private readonly fileService: IFileService,
		@ILogService logService: ILogService,
	) {
		super(workspace, userDataProfileService, logService);
	}

	protected override async createStorageDatabase(scope: StorageScope, profile: IUserDataProfile): Promise<IIndexedDBStorageDatabase> {
		let resource: URI;
		let watch: boolean;
		switch (scope) {
			case StorageScope.APPLICATION:
				resource = joinPath(this.userRoamingDataHome, 'globalStorage', STATE_FILE_NAME);
				watch = true;
				break;
			case StorageScope.APPLICATION_SHARED:
				resource = joinPath(this.userRoamingDataHome, 'globalStorage', SHARED_STATE_FILE_NAME);
				watch = true;
				break;
			case StorageScope.PROFILE:
				resource = joinPath(profile.globalStorageHome, STATE_FILE_NAME);
				watch = true;
				break;
			default:
				// Like IndexedDB in the browser: workspace state is not shared live between tabs.
				resource = joinPath(this.workspaceStorageHome, this.workspace.id, STATE_FILE_NAME);
				watch = false;
		}

		try {
			return await FileStorageDatabase.create(resource, watch, this.fileService, this.logService);
		} catch (error) {
			this.logService.error(`[HostedStorage] cannot use ${resource.toString()}, falling back to the browser: ${toErrorMessage(error)}`);
			return super.createStorageDatabase(scope, profile);
		}
	}
}

/**
 * A storage database kept as one JSON object (`key -> value`) in a file.
 *
 * Writes are the whole object, so one write is one file operation (and can still go out
 * while the page unloads). With `watch`, changes that another tab or browser writes to the
 * file are read back and reported through `onDidChangeItemsExternal`.
 */
export class FileStorageDatabase extends Disposable implements IIndexedDBStorageDatabase {

	static async create(resource: URI, watch: boolean, fileService: IFileService, logService: ILogService): Promise<FileStorageDatabase> {
		const database = new FileStorageDatabase(resource, watch, fileService, logService);
		try {
			await database.load();
		} catch (error) {
			database.dispose();
			throw error;
		}
		return database;
	}

	private readonly _onDidChangeItemsExternal = this._register(new Emitter<IStorageItemsChangeEvent>());
	readonly onDidChangeItemsExternal = this._onDidChangeItemsExternal.event;

	readonly name: string;

	/** The state as this tab sees it. */
	private items = new Map<string, string>();

	/** The state last read from or written to the file. */
	private persisted = new Map<string, string>();

	private readonly writeSequencer = new Sequencer();
	private pendingWrites = 0;
	get hasPendingUpdate(): boolean { return this.pendingWrites > 0; }

	private constructor(
		private readonly resource: URI,
		watch: boolean,
		private readonly fileService: IFileService,
		private readonly logService: ILogService,
	) {
		super();

		this.name = resource.toString();

		if (watch) {
			const watcher = this._register(this.fileService.createWatcher(this.resource, { recursive: false, excludes: [] }));
			this._register(watcher.onDidChange(e => {
				if (e.contains(this.resource) && !this.hasPendingUpdate) {
					this.reload();
				}
			}));
		}
	}

	private async load(): Promise<void> {
		const items = await this.readFile();
		this.items = new Map(items);
		this.persisted = items;
	}

	private async readFile(): Promise<Map<string, string>> {
		let content: string;
		try {
			content = (await this.fileService.readFile(this.resource, { atomic: true })).value.toString();
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return new Map();
			}
			throw error;
		}

		const items = new Map<string, string>();
		if (!content) {
			return items;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(content);
		} catch (error) {
			this.logService.error(`[HostedStorage] ${this.name} is not valid JSON, starting empty`, error);
			return items;
		}

		if (parsed && typeof parsed === 'object') {
			for (const [key, value] of Object.entries(parsed)) {
				if (typeof value === 'string') {
					items.set(key, value);
				}
			}
		}
		return items;
	}

	private async reload(): Promise<void> {
		let fromFile: Map<string, string>;
		try {
			fromFile = await this.readFile();
		} catch (error) {
			this.logService.error(`[HostedStorage] cannot read ${this.name}`, error);
			return;
		}

		// Only what changed in the file since we last read or wrote it is an external change.
		const changed = new Map<string, string>();
		const deleted = new Set<string>();
		for (const [key, value] of fromFile) {
			if (this.persisted.get(key) !== value) {
				changed.set(key, value);
			}
		}
		for (const key of this.persisted.keys()) {
			if (!fromFile.has(key)) {
				deleted.add(key);
			}
		}
		this.persisted = fromFile;

		if (!changed.size && !deleted.size) {
			return;
		}

		for (const [key, value] of changed) {
			this.items.set(key, value);
		}
		for (const key of deleted) {
			this.items.delete(key);
		}
		this._onDidChangeItemsExternal.fire({ changed, deleted });
	}

	async getItems(): Promise<Map<string, string>> {
		return new Map(this.items);
	}

	async getValue(key: string): Promise<string | undefined> {
		return this.items.get(key);
	}

	async updateItems(request: IUpdateRequest): Promise<void> {
		const toInsert = request.insert;
		const toDelete = request.delete;
		if ((!toInsert || toInsert.size === 0) && (!toDelete || toDelete.size === 0)) {
			return;
		}

		for (const [key, value] of toInsert ?? []) {
			this.items.set(key, value);
		}
		for (const key of toDelete ?? []) {
			this.items.delete(key);
		}

		return this.write();
	}

	async compareAndSwap(key: string, expectedValue: string | undefined, newValue: string): Promise<{ readonly swapped: boolean; readonly currentValue: string | undefined }> {
		const currentValue = this.items.get(key);
		if (currentValue !== expectedValue) {
			return { swapped: false, currentValue };
		}

		this.items.set(key, newValue);
		await this.write();
		this._onDidChangeItemsExternal.fire({ changed: new Map([[key, newValue]]) });
		return { swapped: true, currentValue: newValue };
	}

	private write(): Promise<void> {
		this.pendingWrites++;
		const snapshot = new Map(this.items);
		return this.writeSequencer.queue(async () => {
			try {
				await this.fileService.writeFile(this.resource, VSBuffer.fromString(JSON.stringify(Object.fromEntries(snapshot))), { atomic: { postfix: '.vsctmp' } });
				this.persisted = snapshot;
			} finally {
				this.pendingWrites--;
			}
		});
	}

	async optimize(): Promise<void> {
		// nothing to optimize in a JSON file
	}

	async close(): Promise<void> {
		await this.writeSequencer.queue(async () => { /* wait for pending writes */ });
		this.dispose();
	}

	async clear(): Promise<void> {
		this.items.clear();
		await this.write();
	}
}
