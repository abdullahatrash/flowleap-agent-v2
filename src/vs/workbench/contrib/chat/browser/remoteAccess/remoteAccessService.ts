/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Throttler, IntervalTimer } from '../../../../../base/common/async.js';
import { decodeBase64, encodeBase64, VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IObservable, ISettableObservable, observableValue } from '../../../../../base/common/observable.js';
import { OS, OperatingSystem } from '../../../../../base/common/platform.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { localize } from '../../../../../nls.js';
import { IAgentHostService } from '../../../../../platform/agentHost/common/agentService.js';
import { computePairingProof, derivePairKey, formatPairingCode, formatPairingUrl, generatePairSecret, isUuid } from '../../../../../platform/agentHost/common/remoteAccessCrypto.js';
import { IRemoteAccessHostConfig, IRemoteAccessHostStatus, REMOTE_ACCESS_STOPPED_STATUS } from '../../../../../platform/agentHost/common/remoteAccessHost.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { asJson, IRequestService, isSuccess } from '../../../../../platform/request/common/request.js';
import { ISecretStorageService } from '../../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IAuthenticationService } from '../../../../services/authentication/common/authentication.js';
import {
	FLOWLEAP_AUTHENTICATION_PROVIDER_ID, getRemoteAccessPairsUrl, IRemoteAccessPair, IRemoteAccessPairingOffer, IRemoteAccessService,
	REMOTE_ACCESS_DEFAULT_RELAY_URL, REMOTE_ACCESS_OFFER_TTL_MS, REMOTE_ACCESS_PAIR_KEY_SECRET_PREFIX, RemoteAccessEnabledContext,
	RemoteAccessError, RemoteAccessErrorKind, RemoteAccessSettingId, RemoteAccessStorageKey,
} from '../../common/remoteAccess/remoteAccess.js';

const LOG_PREFIX = '[RemoteAccess]';
const STATUS_POLL_MS = 5_000;

function osLabel(): string {
	switch (OS) {
		case OperatingSystem.Macintosh: return 'macOS';
		case OperatingSystem.Windows: return 'Windows';
		default: return 'Linux';
	}
}

function readPairs(value: unknown): IRemoteAccessPair[] {
	const list = Array.isArray(value) ? value : (value && typeof value === 'object' && Array.isArray((value as { pairs?: unknown }).pairs) ? (value as { pairs: unknown[] }).pairs : []);
	const pairs: IRemoteAccessPair[] = [];
	for (const item of list) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const record = item as Record<string, unknown>;
		if (typeof record.pairId !== 'string' || typeof record.hostId !== 'string') {
			continue;
		}
		pairs.push({
			pairId: record.pairId.toLowerCase(),
			hostId: record.hostId,
			hostLabel: typeof record.hostLabel === 'string' ? record.hostLabel : undefined,
			viewerLabel: typeof record.viewerLabel === 'string' ? record.viewerLabel : undefined,
			state: typeof record.state === 'string' ? record.state : undefined,
			createdAt: typeof record.createdAt === 'string' || typeof record.createdAt === 'number' ? record.createdAt : undefined,
			lastSeenAt: typeof record.lastSeenAt === 'string' || typeof record.lastSeenAt === 'number' ? record.lastSeenAt : undefined,
		});
	}
	return pairs;
}

/**
 * Host-side Remote Access state: the switch, the Host id, the pairs and their
 * keys, and the push of all of it (with the FlowLeap Session token) to the
 * agent host, which runs the Relay transport. The token is read from the
 * `flowleap` authentication provider and never written to disk or logs.
 */
export class RemoteAccessService extends Disposable implements IRemoteAccessService {
	declare readonly _serviceBrand: undefined;

	private readonly _enabled: ISettableObservable<boolean>;
	readonly enabled: IObservable<boolean>;
	private readonly _signedIn = observableValue<boolean>(this, false);
	readonly signedIn: IObservable<boolean> = this._signedIn;
	private readonly _pairs: ISettableObservable<readonly IRemoteAccessPair[]>;
	readonly pairs: IObservable<readonly IRemoteAccessPair[]>;
	private readonly _hostStatus = observableValue<IRemoteAccessHostStatus>(this, REMOTE_ACCESS_STOPPED_STATUS);
	readonly hostStatus: IObservable<IRemoteAccessHostStatus> = this._hostStatus;

	readonly hostId: string;

	private readonly _enabledContext: IContextKey<boolean>;
	private _token: string | undefined;
	private readonly _pendingOffers = new Map<string, number>();
	private readonly _pushThrottler = this._register(new Throttler());
	private readonly _statusPoll = this._register(new IntervalTimer());

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@ISecretStorageService private readonly _secretStorageService: ISecretStorageService,
		@IAuthenticationService private readonly _authenticationService: IAuthenticationService,
		@IRequestService private readonly _requestService: IRequestService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IProductService private readonly _productService: IProductService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ILogService private readonly _logService: ILogService,
		@IAgentHostService private readonly _agentHostService: IAgentHostService,
	) {
		super();

		let hostId = this._storageService.get(RemoteAccessStorageKey.HostId, StorageScope.APPLICATION);
		if (!hostId || !isUuid(hostId)) {
			hostId = generateUuid();
			this._storageService.store(RemoteAccessStorageKey.HostId, hostId, StorageScope.APPLICATION, StorageTarget.MACHINE);
		}
		this.hostId = hostId;

		this._enabled = observableValue<boolean>(this, this._readEnabled());
		this.enabled = this._enabled;
		this._pairs = observableValue<readonly IRemoteAccessPair[]>(this, this._readCachedPairs());
		this.pairs = this._pairs;

		this._enabledContext = RemoteAccessEnabledContext.bindTo(contextKeyService);
		this._enabledContext.set(this._enabled.get());

		// Another window switched it.
		this._register(this._storageService.onDidChangeValue(StorageScope.APPLICATION, RemoteAccessStorageKey.Enabled, this._store)(() => this._applyEnabled(this._readEnabled())));
		this._register(this._storageService.onDidChangeValue(StorageScope.APPLICATION, RemoteAccessStorageKey.PairKeyIds, this._store)(() => this._schedulePush()));
		this._register(this._storageService.onDidChangeValue(StorageScope.APPLICATION, RemoteAccessStorageKey.Pairs, this._store)(() => this._pairs.set(this._readCachedPairs(), undefined)));
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(RemoteAccessSettingId.RelayUrl)) {
				this._schedulePush();
			}
		}));
		this._register(this._authenticationService.onDidChangeSessions(e => {
			if (e.providerId === FLOWLEAP_AUTHENTICATION_PROVIDER_ID) {
				void this._refreshToken(!!e.event.removed?.length);
			}
		}));
		this._register(this._authenticationService.onDidRegisterAuthenticationProvider(e => {
			if (e.id === FLOWLEAP_AUTHENTICATION_PROVIDER_ID) {
				void this._refreshToken(false);
			}
		}));
		this._register(this._agentHostService.onAgentHostStart(() => this._schedulePush()));

		void this._refreshToken(false);
		this._onDidChangeEnabled();
	}

	// ---- Switch ---------------------------------------------------------------

	private _readEnabled(): boolean {
		return this._storageService.getBoolean(RemoteAccessStorageKey.Enabled, StorageScope.APPLICATION, false);
	}

	async setEnabled(enabled: boolean): Promise<void> {
		if (enabled && !this._token) {
			await this._refreshToken(false);
			if (!this._token) {
				throw new RemoteAccessError(RemoteAccessErrorKind.NotSignedIn, localize('remoteAccess.notSignedIn', "Sign in to FlowLeap to use Remote Access."));
			}
		}
		this._storageService.store(RemoteAccessStorageKey.Enabled, enabled, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this._applyEnabled(enabled);
		if (enabled) {
			void this.refreshPairs().catch(error => this._logService.warn(`${LOG_PREFIX} Could not list pairs: ${errorMessage(error)}`));
		}
	}

	private _applyEnabled(enabled: boolean): void {
		if (this._enabled.get() === enabled) {
			return;
		}
		this._enabled.set(enabled, undefined);
		this._enabledContext.set(enabled);
		this._onDidChangeEnabled();
	}

	private _onDidChangeEnabled(): void {
		if (this._enabled.get()) {
			this._statusPoll.cancelAndSet(() => void this._pollStatus(), STATUS_POLL_MS);
		} else {
			this._statusPoll.cancel();
			this._hostStatus.set(REMOTE_ACCESS_STOPPED_STATUS, undefined);
		}
		this._schedulePush();
	}

	// ---- FlowLeap Session token ---------------------------------------------------

	private async _refreshToken(sessionRemoved: boolean): Promise<void> {
		const previous = this._token;
		let token: string | undefined;
		try {
			const sessions = await this._authenticationService.getSessions(FLOWLEAP_AUTHENTICATION_PROVIDER_ID);
			token = sessions[0]?.accessToken || undefined;
		} catch {
			// The provider is not registered yet (extension still activating).
			token = undefined;
		}
		this._token = token;
		this._signedIn.set(!!token, undefined);
		if (previous && !token && sessionRemoved) {
			await this._onSignedOut(previous);
		} else if (previous !== token) {
			this._schedulePush();
		}
	}

	/** Sign-out on the Host revokes its pairs (grill Q14) and switches Remote Access off. */
	private async _onSignedOut(lastToken: string): Promise<void> {
		this._logService.info(`${LOG_PREFIX} Signed out: revoking this Host's pairs`);
		try {
			await this._send('DELETE', `${this._pairsUrl()}?hostId=${encodeURIComponent(this.hostId)}`, lastToken);
		} catch (error) {
			this._logService.warn(`${LOG_PREFIX} Could not revoke pairs on the Relay: ${errorMessage(error)}`);
		}
		await this._forgetAllLocalPairs();
		this._storageService.store(RemoteAccessStorageKey.Enabled, false, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this._applyEnabled(false);
	}

	private async _requireToken(): Promise<string> {
		if (!this._token) {
			await this._refreshToken(false);
		}
		if (!this._token) {
			throw new RemoteAccessError(RemoteAccessErrorKind.NotSignedIn, localize('remoteAccess.notSignedIn', "Sign in to FlowLeap to use Remote Access."));
		}
		return this._token;
	}

	// ---- Relay REST (section 5) ------------------------------------------------------

	private _relayUrl(): string {
		const configured = this._configurationService.getValue<string>(RemoteAccessSettingId.RelayUrl);
		return typeof configured === 'string' && configured.trim() ? configured.trim() : REMOTE_ACCESS_DEFAULT_RELAY_URL;
	}

	private _pairsUrl(): string {
		return getRemoteAccessPairsUrl(this._relayUrl());
	}

	private async _send(method: string, url: string, token: string, body?: object): Promise<unknown> {
		const context = await this._requestService.request({
			type: method,
			url,
			headers: {
				'Authorization': `Bearer ${token}`,
				...(body ? { 'Content-Type': 'application/json' } : {}),
			},
			data: body ? JSON.stringify(body) : undefined,
			callSite: 'remoteAccess',
		}, CancellationToken.None);
		const status = context.res.statusCode;
		if (status === 402) {
			throw new RemoteAccessError(RemoteAccessErrorKind.SubscriptionRequired, localize('remoteAccess.subscriptionRequired', "Remote Access needs an active FlowLeap subscription or trial."), status);
		}
		if (status === 401) {
			throw new RemoteAccessError(RemoteAccessErrorKind.NotSignedIn, localize('remoteAccess.notSignedIn', "Sign in to FlowLeap to use Remote Access."), status);
		}
		if (!isSuccess(context)) {
			throw new RemoteAccessError(RemoteAccessErrorKind.RequestFailed, localize('remoteAccess.requestFailed', "The Relay answered {0}.", String(status ?? 'no status')), status);
		}
		return status === 204 ? undefined : await asJson<unknown>(context).catch(() => undefined);
	}

	async refreshPairs(): Promise<void> {
		const token = await this._requireToken();
		const all = readPairs(await this._send('GET', this._pairsUrl(), token));
		const mine = all.filter(pair => pair.hostId === this.hostId);
		this._storeCachedPairs(mine);

		// Forget keys of pairs the Relay no longer has (removed on the Viewer),
		// except fresh offers the Viewer may still claim.
		const listed = new Set(mine.map(pair => pair.pairId));
		const now = Date.now();
		for (const pairId of this._readPairKeyIds()) {
			const offeredAt = this._pendingOffers.get(pairId);
			const pending = offeredAt !== undefined && now - offeredAt < REMOTE_ACCESS_OFFER_TTL_MS;
			if (!listed.has(pairId) && !pending) {
				await this._forgetPairKey(pairId);
			}
		}
	}

	async startPairing(): Promise<IRemoteAccessPairingOffer> {
		const token = await this._requireToken();
		const pairSecret = generatePairSecret();
		const proof = await computePairingProof(pairSecret, this.hostId);
		const hostLabel = localize('remoteAccess.hostLabel', "{0} on {1}", this._productService.nameShort, osLabel());
		const response = await this._send('POST', this._pairsUrl(), token, { hostId: this.hostId, hostLabel, proof });
		const pairId = response && typeof response === 'object' && typeof (response as { pairId?: unknown }).pairId === 'string'
			? (response as { pairId: string }).pairId.toLowerCase()
			: undefined;
		if (!pairId || !isUuid(pairId)) {
			throw new RemoteAccessError(RemoteAccessErrorKind.RequestFailed, localize('remoteAccess.badPairResponse', "The Relay did not return a pair id."));
		}
		const pairKey = await derivePairKey(pairSecret, pairId);
		await this._secretStorageService.set(REMOTE_ACCESS_PAIR_KEY_SECRET_PREFIX + pairId, encodeBase64(VSBuffer.wrap(pairKey)));
		this._pendingOffers.set(pairId, Date.now());
		this._storePairKeyIds([...new Set([...this._readPairKeyIds(), pairId])]);
		this._schedulePush();
		// The pair secret leaves this function only inside the code and the URL.
		return { pairId, code: formatPairingCode(pairId, pairSecret), url: formatPairingUrl(pairId, pairSecret) };
	}

	async removePair(pairId: string): Promise<void> {
		const token = await this._requireToken();
		try {
			await this._send('DELETE', `${this._pairsUrl()}/${encodeURIComponent(pairId)}`, token);
		} catch (error) {
			if (!(error instanceof RemoteAccessError && error.statusCode === 404)) {
				throw error;
			}
		}
		await this._forgetPairKey(pairId);
		this._storeCachedPairs(this._pairs.get().filter(pair => pair.pairId !== pairId));
	}

	async revokeAll(): Promise<void> {
		const token = await this._requireToken();
		await this._send('DELETE', `${this._pairsUrl()}?hostId=${encodeURIComponent(this.hostId)}`, token);
		await this._forgetAllLocalPairs();
	}

	// ---- Local pair state -----------------------------------------------------

	private _readCachedPairs(): IRemoteAccessPair[] {
		try {
			return readPairs(JSON.parse(this._storageService.get(RemoteAccessStorageKey.Pairs, StorageScope.APPLICATION, '[]')));
		} catch {
			return [];
		}
	}

	private _storeCachedPairs(pairs: readonly IRemoteAccessPair[]): void {
		this._pairs.set(pairs, undefined);
		this._storageService.store(RemoteAccessStorageKey.Pairs, JSON.stringify(pairs), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	private _readPairKeyIds(): string[] {
		try {
			const value: unknown = JSON.parse(this._storageService.get(RemoteAccessStorageKey.PairKeyIds, StorageScope.APPLICATION, '[]'));
			return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && isUuid(id)) : [];
		} catch {
			return [];
		}
	}

	private _storePairKeyIds(ids: readonly string[]): void {
		this._storageService.store(RemoteAccessStorageKey.PairKeyIds, JSON.stringify(ids), StorageScope.APPLICATION, StorageTarget.MACHINE);
		this._schedulePush();
	}

	private async _forgetPairKey(pairId: string): Promise<void> {
		await this._secretStorageService.delete(REMOTE_ACCESS_PAIR_KEY_SECRET_PREFIX + pairId);
		this._pendingOffers.delete(pairId);
		this._storePairKeyIds(this._readPairKeyIds().filter(id => id !== pairId));
	}

	private async _forgetAllLocalPairs(): Promise<void> {
		for (const pairId of this._readPairKeyIds()) {
			await this._secretStorageService.delete(REMOTE_ACCESS_PAIR_KEY_SECRET_PREFIX + pairId);
		}
		this._pendingOffers.clear();
		this._storePairKeyIds([]);
		this._storeCachedPairs([]);
	}

	// ---- Push to the agent host ----------------------------------------------

	private _schedulePush(): void {
		if (!this._agentHostService.setRemoteAccessHost) {
			return;
		}
		void this._pushThrottler.queue(async () => {
			if (this._store.isDisposed) {
				return;
			}
			const config = await this._buildConfig();
			if (config === 'unchanged') {
				return;
			}
			try {
				await this._agentHostService.setRemoteAccessHost?.(config);
			} catch (error) {
				this._logService.warn(`${LOG_PREFIX} Could not update the Host transport: ${errorMessage(error)}`);
			}
			if (config) {
				void this._pollStatus();
			}
		});
	}

	/**
	 * `undefined` switches the Host transport off. `'unchanged'` leaves the
	 * agent host as it is: on but with no token yet, this window may still be
	 * waiting for the authentication provider, and another window may be
	 * running the transport. Sign-out switches Remote Access off explicitly.
	 */
	private async _buildConfig(): Promise<IRemoteAccessHostConfig | undefined | 'unchanged'> {
		if (!this._enabled.get()) {
			return undefined;
		}
		const token = this._token;
		if (!token) {
			return 'unchanged';
		}
		const pairs: { pairId: string; pairKey: string }[] = [];
		for (const pairId of this._readPairKeyIds()) {
			const pairKey = await this._secretStorageService.get(REMOTE_ACCESS_PAIR_KEY_SECRET_PREFIX + pairId);
			if (pairKey && decodeBase64(pairKey).byteLength === 32) {
				pairs.push({ pairId, pairKey });
			}
		}
		return { relayUrl: this._relayUrl(), token, hostId: this.hostId, pairs };
	}

	private async _pollStatus(): Promise<void> {
		if (!this._enabled.get() || !this._agentHostService.getRemoteAccessHostStatus) {
			return;
		}
		try {
			const status = await this._agentHostService.getRemoteAccessHostStatus();
			if (this._enabled.get()) {
				this._hostStatus.set(status, undefined);
			}
		} catch {
			// The agent host is restarting; the next poll or start event catches up.
		}
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
