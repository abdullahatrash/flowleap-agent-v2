/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../platform/log/common/logService';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import {
	PatentDataKeys,
	PatentEpoCredentials,
	registerPatentDataKeysProvider,
} from '../common/patentDataKeysRegistry';

/** SecretStorage key, parallel to the auth provider's `patent-ai-clerk-token`. */
const DATA_KEYS_STORAGE_KEY = 'patent-ai-data-keys';

/**
 * Owner of the user's BYO patent-data keys (EPO OPS consumer key+secret, USPTO ODP key).
 *
 * Keys live ONLY in SecretStorage (issue #31, ADR 0005) — never in settings.json, never
 * logged (log lines carry presence booleans only). On construction the store registers a
 * synchronous accessor with the {@link registerPatentDataKeysProvider} registry seam, which
 * the patent backend client reads on every request to attach the #30 wire-contract headers.
 * The Keys UI (#32) drives the set/clear methods; each provider is independently
 * configurable (EPO-only / USPTO-only are first-class states).
 */
export class PatentDataKeysStore {

	private _keys: PatentDataKeys | undefined;

	private readonly _onDidChange = new Emitter<void>();
	/** Fires when the configured keys change (load, set, clear) — drives status UI refreshes. */
	readonly onDidChange: Event<void> = this._onDidChange.event;

	/** Resolves once the initial SecretStorage load completed (the accessor returns undefined until then). */
	readonly whenReady: Promise<void>;

	static register(context: IVSCodeExtensionContext, logService: ILogService): PatentDataKeysStore {
		return new PatentDataKeysStore(context, logService);
	}

	constructor(
		private readonly _context: IVSCodeExtensionContext,
		private readonly _logService: ILogService,
	) {
		registerPatentDataKeysProvider(() => this._keys);
		this.whenReady = this._load();
	}

	private async _load(): Promise<void> {
		try {
			const raw = await this._context.secrets.get(DATA_KEYS_STORAGE_KEY);
			if (!raw) {
				return;
			}
			const parsed = JSON.parse(raw) as PatentDataKeys;
			// Only adopt well-formed entries — a malformed secret must not produce half an EPO
			// pair (the backend rejects mismatched pairs by design).
			this._keys = {
				...(parsed.epo?.key && parsed.epo.secret ? { epo: { key: parsed.epo.key, secret: parsed.epo.secret } } : {}),
				...(typeof parsed.usptoOdp === 'string' && parsed.usptoOdp ? { usptoOdp: parsed.usptoOdp } : {}),
			};
			this._logService.info(`[Patent AI] Data keys loaded (epo=${!!this._keys.epo}, usptoOdp=${!!this._keys.usptoOdp})`);
			this._onDidChange.fire();
		} catch (error) {
			this._logService.error(`[Patent AI] Failed to load data keys: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/** The current keys snapshot (undefined until the initial load resolves or after clearAll). */
	getKeys(): PatentDataKeys | undefined {
		return this._keys;
	}

	async setEpoCredentials(credentials: PatentEpoCredentials): Promise<void> {
		this._keys = { ...this._keys, epo: credentials };
		await this._persist();
		this._logService.info('[Patent AI] EPO OPS credentials stored');
	}

	async setUsptoOdpKey(key: string): Promise<void> {
		this._keys = { ...this._keys, usptoOdp: key };
		await this._persist();
		this._logService.info('[Patent AI] USPTO ODP key stored');
	}

	async clearProvider(provider: 'epo' | 'uspto'): Promise<void> {
		const { epo, usptoOdp } = this._keys ?? {};
		this._keys = {
			...(provider !== 'epo' && epo ? { epo } : {}),
			...(provider !== 'uspto' && usptoOdp ? { usptoOdp } : {}),
		};
		await this._persist();
		this._logService.info(`[Patent AI] ${provider === 'epo' ? 'EPO OPS credentials' : 'USPTO ODP key'} cleared`);
	}

	private async _persist(): Promise<void> {
		if (this._keys && (this._keys.epo || this._keys.usptoOdp)) {
			await this._context.secrets.store(DATA_KEYS_STORAGE_KEY, JSON.stringify(this._keys));
		} else {
			this._keys = undefined;
			await this._context.secrets.delete(DATA_KEYS_STORAGE_KEY);
		}
		this._onDidChange.fire();
	}
}
