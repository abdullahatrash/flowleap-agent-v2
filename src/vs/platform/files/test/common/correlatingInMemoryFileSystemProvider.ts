/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileChange, IWatchOptions } from '../../common/files.js';
import { InMemoryFileSystemProvider } from '../../common/inMemoryFilesystemProvider.js';

/**
 * An in-memory file system that also reports every change to each correlated watcher
 * (`IFileService.createWatcher`), like the disk and remote file systems do.
 */
export class CorrelatingInMemoryFileSystemProvider extends InMemoryFileSystemProvider {

	private readonly correlationIds = new Set<number>();
	private readonly uncorrelatedOnDidChangeFile = this.onDidChangeFile;

	private readonly allChanges = this._register(new Emitter<readonly IFileChange[]>());
	override readonly onDidChangeFile: Event<readonly IFileChange[]> = this.allChanges.event;

	constructor() {
		super();

		// One batch per correlation, as the file service drops batches with mixed correlations
		this._register(this.uncorrelatedOnDidChangeFile(changes => {
			this.allChanges.fire(changes);
			for (const cId of this.correlationIds) {
				this.allChanges.fire(changes.map(change => ({ ...change, cId })));
			}
		}));
	}

	override watch(resource: URI, opts: IWatchOptions): IDisposable {
		const correlationId = opts.correlationId;
		if (typeof correlationId === 'number') {
			this.correlationIds.add(correlationId);
			return toDisposable(() => this.correlationIds.delete(correlationId));
		}
		return super.watch(resource, opts);
	}
}
