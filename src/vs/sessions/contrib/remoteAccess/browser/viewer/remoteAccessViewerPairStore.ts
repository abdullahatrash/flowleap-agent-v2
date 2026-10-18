/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The Viewer's pair keys, in the page's IndexedDB (contract section 5 step 4:
// "keep it in their local secret storage"). The browser has no secret store
// for a static page; IndexedDB of the remote.flowleap.co origin is the place
// that survives a reload and stays out of every request. Anyone who can read
// this browser profile can read the key, as with any web sign-in.

/** One pair this browser claimed. */
export interface IStoredViewerPair {
	readonly pairId: string;
	readonly hostLabel: string;
	/** The 32-byte pair key. */
	readonly pairKey: Uint8Array;
	readonly claimedAt: number;
}

const DATABASE_NAME = 'flowleap-remote-access';
const DATABASE_VERSION = 1;
const STORE_NAME = 'pairs';

function promisify<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
	});
}

function isStoredPair(value: unknown): value is IStoredViewerPair {
	const row = value as Partial<IStoredViewerPair> | undefined;
	return typeof row?.pairId === 'string' && typeof row.hostLabel === 'string' && row.pairKey instanceof Uint8Array && row.pairKey.byteLength === 32;
}

export class RemoteAccessViewerPairStore {

	static async open(factory: IDBFactory = indexedDB): Promise<RemoteAccessViewerPairStore> {
		const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
		request.onupgradeneeded = () => {
			const database = request.result;
			if (!database.objectStoreNames.contains(STORE_NAME)) {
				database.createObjectStore(STORE_NAME, { keyPath: 'pairId' });
			}
		};
		return new RemoteAccessViewerPairStore(await promisify(request));
	}

	private constructor(private readonly _database: IDBDatabase) { }

	private _store(mode: IDBTransactionMode): IDBObjectStore {
		return this._database.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
	}

	async list(): Promise<IStoredViewerPair[]> {
		const rows = await promisify(this._store('readonly').getAll());
		return rows.filter(isStoredPair);
	}

	async get(pairId: string): Promise<IStoredViewerPair | undefined> {
		const row = await promisify(this._store('readonly').get(pairId.toLowerCase()));
		return isStoredPair(row) ? row : undefined;
	}

	async put(pair: IStoredViewerPair): Promise<void> {
		await promisify(this._store('readwrite').put({ ...pair, pairId: pair.pairId.toLowerCase(), pairKey: new Uint8Array(pair.pairKey) }));
	}

	async delete(pairId: string): Promise<void> {
		await promisify(this._store('readwrite').delete(pairId.toLowerCase()));
	}

	close(): void {
		this._database.close();
	}
}
