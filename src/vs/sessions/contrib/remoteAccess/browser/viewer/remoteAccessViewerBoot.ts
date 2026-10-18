/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The Remote Access Viewer boot page (PRD 0018 B4, contract section 8):
// Clerk sign-in → GET /pairs (and the /pair#<code> claim) → pick a pair →
// open the Viewer socket and read the Host's version → reload into the
// matching build when it differs → boot the web Agents Window with the pair.
//
// `loader.js` (remoteAccessViewerLoader.ts) picks this build's folder and
// imports this module. Each build has its own copy, so the boot page and the
// workbench it boots always come from the same build.

import { mainWindow } from '../../../../../base/browser/window.js';
import { localize } from '../../../../../nls.js';
import { IRemoteAccessPairingCode, parsePairingCode } from '../../../../../platform/agentHost/common/remoteAccessCrypto.js';
import { createViewerHello, IRelayHostPeer, parseViewerControlFrame, RelayCloseCode } from '../../../../../platform/agentHost/common/remoteAccessRelayProtocol.js';
import { getRemoteAccessViewerCloseMessage, IRemoteAccessViewerOptions, IRemoteAccessViewerStatus, isRemoteAccessViewerRefusal, RemoteAccessViewerState } from '../../../../../platform/agentHost/common/remoteAccessViewer.js';
import type { IWorkbenchConstructionOptions } from '../../../../../workbench/browser/web.api.js';
import {
	claimPairing, clerkFrontendApiFromPublishableKey, defaultViewerLabel, IRemoteAccessPairView, IRemoteAccessViewerBuilds, IRemoteAccessViewerConfig,
	pairingCodeFromLocation, parseViewerConfig, pickBuildForHost, RemoteAccessViewerApi, ViewerApiError, ViewerApiErrorKind, ViewerBuildPick, ViewerFetch, viewerPairStatus, ViewerPairStatus,
} from '../../common/remoteAccessViewerBoot.js';
import { RemoteAccessViewerPairStore } from './remoteAccessViewerPairStore.js';

/** What `loader.js` leaves for this module. */
interface IViewerLoaderEnvironment {
	readonly buildVersion: string;
	/** `https://remote.flowleap.co/<version>/out/` */
	readonly fileRoot: string;
	readonly builds: IRemoteAccessViewerBuilds;
	readonly config: unknown;
}

/** The subset of the Clerk browser SDK (`window.Clerk`) the page uses. */
interface IClerk {
	load(options?: object): Promise<void>;
	readonly user: object | null | undefined;
	readonly session: { getToken(): Promise<string | null> } | null | undefined;
	mountSignIn(element: HTMLDivElement, props?: object): void;
	unmountSignIn(element: HTMLDivElement): void;
	addListener(listener: (resources: { user?: object | null }) => void): () => void;
	signOut(): Promise<void>;
}

interface IViewerWorkbenchModule {
	create(element: HTMLElement, options: IWorkbenchConstructionOptions): { dispose(): void };
}

/** Survives the reload into another build, so the page follows the same pair after it. */
const FOLLOW_SESSION_KEY = 'flowleap.remoteAccess.follow';
/** The last pair this browser followed: the page follows it again on the next visit. */
const LAST_PAIR_KEY = 'flowleap.remoteAccess.lastPairId';
const CLERK_JS_MAJOR = '5';
const PROBE_TIMEOUT_MS = 8_000;

function storageGet(storage: () => Storage, key: string): string | undefined {
	try {
		return storage().getItem(key) ?? undefined;
	} catch {
		return undefined;
	}
}

function storageSet(storage: () => Storage, key: string, value: string | undefined): void {
	try {
		if (value === undefined) {
			storage().removeItem(key);
		} else {
			storage().setItem(key, value);
		}
	} catch {
		// Private mode or blocked storage: the page still works, it only forgets.
	}
}

// ---- Page view -----------------------------------------------------------------------

const STYLE = `
:root { color-scheme: light dark; --fl-bg: #f7f7f8; --fl-card: #ffffff; --fl-text: #1d1d1f; --fl-muted: #6b6b70; --fl-border: #d9d9de; --fl-accent: #2f5bea; --fl-accent-text: #ffffff; --fl-error: #b3261e; --fl-banner: #fff4d6; --fl-banner-text: #4a3800; }
@media (prefers-color-scheme: dark) { :root { --fl-bg: #18181b; --fl-card: #232327; --fl-text: #ececf1; --fl-muted: #a0a0a8; --fl-border: #3a3a40; --fl-accent: #6d8cff; --fl-accent-text: #0b0b0f; --fl-error: #ff8a80; --fl-banner: #3b3214; --fl-banner-text: #ffe9a8; } }
.fl-boot { position: fixed; inset: 0; overflow: auto; background: var(--fl-bg); color: var(--fl-text); font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; padding: 32px 16px; box-sizing: border-box; z-index: 10; }
.fl-card { width: 100%; max-width: 440px; }
.fl-card h1 { font-size: 20px; margin: 0 0 4px; }
.fl-card p { margin: 0 0 16px; color: var(--fl-muted); }
.fl-list { list-style: none; margin: 0 0 20px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.fl-row { background: var(--fl-card); border: 1px solid var(--fl-border); border-radius: 10px; padding: 12px; display: flex; align-items: center; gap: 8px; }
.fl-row-text { flex: 1; min-width: 0; }
.fl-row-title { font-weight: 600; overflow-wrap: anywhere; }
.fl-row-detail { color: var(--fl-muted); font-size: 13px; }
.fl-button { font: inherit; border-radius: 8px; border: 1px solid var(--fl-border); background: var(--fl-card); color: var(--fl-text); padding: 8px 14px; min-height: 40px; cursor: pointer; }
.fl-button.fl-primary { background: var(--fl-accent); border-color: var(--fl-accent); color: var(--fl-accent-text); }
.fl-button:disabled { opacity: 0.5; cursor: default; }
.fl-code { display: flex; gap: 8px; margin-bottom: 8px; }
.fl-code input { flex: 1; min-width: 0; font: 14px ui-monospace, Menlo, monospace; padding: 8px; border-radius: 8px; border: 1px solid var(--fl-border); background: var(--fl-card); color: var(--fl-text); }
.fl-error { color: var(--fl-error); margin: 0 0 16px; }
.fl-footer { margin-top: 24px; display: flex; justify-content: flex-end; }
.fl-banner { position: fixed; top: 0; left: 0; right: 0; z-index: 100000; background: var(--fl-banner); color: var(--fl-banner-text); font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 6px 12px; display: flex; gap: 12px; align-items: center; justify-content: center; }
.fl-banner[hidden] { display: none; }
.fl-banner a { color: inherit; }
`;

class BootView {
	private readonly _root: HTMLDivElement;
	private readonly _card: HTMLDivElement;

	constructor(private readonly _document: Document) {
		const style = _document.createElement('style');
		style.textContent = STYLE;
		_document.head.appendChild(style);
		this._root = _document.createElement('div');
		this._root.className = 'fl-boot';
		this._card = _document.createElement('div');
		this._card.className = 'fl-card';
		this._root.appendChild(this._card);
		_document.body.appendChild(this._root);
	}

	private _element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
		const element = this._document.createElement(tag);
		if (className) {
			element.className = className;
		}
		if (text !== undefined) {
			element.textContent = text;
		}
		return element;
	}

	private _reset(title: string, detail?: string): void {
		this._card.replaceChildren();
		this._card.appendChild(this._element('h1', undefined, title));
		if (detail) {
			this._card.appendChild(this._element('p', undefined, detail));
		}
	}

	button(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
		const button = this._element('button', primary ? 'fl-button fl-primary' : 'fl-button', label);
		button.type = 'button';
		button.addEventListener('click', onClick);
		return button;
	}

	busy(title: string): void {
		this._reset(localize('remoteAccessViewer.boot.title', "FlowLeap Remote Access"), title);
	}

	fatal(message: string): void {
		this._reset(localize('remoteAccessViewer.boot.title', "FlowLeap Remote Access"));
		this._card.appendChild(this._element('p', 'fl-error', message));
		this._card.appendChild(this.button(localize('remoteAccessViewer.boot.reload', "Reload"), true, () => location.reload()));
	}

	signInContainer(): HTMLDivElement {
		this._reset(localize('remoteAccessViewer.boot.title', "FlowLeap Remote Access"), localize('remoteAccessViewer.boot.signIn', "Sign in with the FlowLeap account you use on the Host."));
		const container = this._element('div');
		this._card.appendChild(container);
		return container;
	}

	pairs(rows: readonly { pair: IRemoteAccessPairView; status: ViewerPairStatus }[], error: string | undefined, handlers: {
		follow(pair: IRemoteAccessPairView): void;
		remove(pair: IRemoteAccessPairView): void;
		pairWithCode(code: string): void;
		signOut(): void;
	}): void {
		this._reset(localize('remoteAccessViewer.boot.title', "FlowLeap Remote Access"), localize('remoteAccessViewer.boot.choose', "Choose the Host to follow. The Host must be on, signed in, with Remote Access switched on."));
		if (error) {
			this._card.appendChild(this._element('p', 'fl-error', error));
		}
		const list = this._element('ul', 'fl-list');
		for (const { pair, status } of rows) {
			const row = this._element('li', 'fl-row');
			const text = this._element('div', 'fl-row-text');
			text.appendChild(this._element('div', 'fl-row-title', pair.hostLabel));
			const detail = status === ViewerPairStatus.Ready
				? localize('remoteAccessViewer.boot.ready', "Paired with this browser")
				: status === ViewerPairStatus.OtherDevice
					? localize('remoteAccessViewer.boot.otherDevice', "Paired with {0}", pair.viewerLabel ?? localize('remoteAccessViewer.boot.anotherViewer', "another Viewer"))
					: localize('remoteAccessViewer.boot.offered', "Waiting for a Viewer to use its pairing code");
			text.appendChild(this._element('div', 'fl-row-detail', detail));
			row.appendChild(text);
			if (status === ViewerPairStatus.Ready) {
				row.appendChild(this.button(localize('remoteAccessViewer.boot.follow', "Follow"), true, () => handlers.follow(pair)));
			}
			if (status !== ViewerPairStatus.Offered) {
				row.appendChild(this.button(localize('remoteAccessViewer.boot.remove', "Remove"), false, () => handlers.remove(pair)));
			}
			list.appendChild(row);
		}
		if (rows.length) {
			this._card.appendChild(list);
		}
		this._card.appendChild(this._element('p', undefined, localize('remoteAccessViewer.boot.pairHelp', "To add a Host: in the FlowLeap Agents Window on the Host, choose Remote Access, then Pair a Viewer. Scan the QR code with this device, or paste the pairing code here.")));
		const form = this._element('div', 'fl-code');
		const input = this._element('input');
		input.type = 'text';
		input.autocomplete = 'off';
		input.spellcheck = false;
		input.placeholder = localize('remoteAccessViewer.boot.codePlaceholder', "Pairing code");
		input.setAttribute('aria-label', localize('remoteAccessViewer.boot.codeLabel', "Pairing code"));
		form.appendChild(input);
		const pairButton = this.button(localize('remoteAccessViewer.boot.pair', "Pair"), rows.every(r => r.status !== ViewerPairStatus.Ready), () => handlers.pairWithCode(input.value));
		form.appendChild(pairButton);
		input.addEventListener('keydown', event => {
			if (event.key === 'Enter') {
				handlers.pairWithCode(input.value);
			}
		});
		this._card.appendChild(form);
		const footer = this._element('div', 'fl-footer');
		footer.appendChild(this.button(localize('remoteAccessViewer.boot.signOut', "Sign Out"), false, handlers.signOut));
		this._card.appendChild(footer);
	}

	remove(): void {
		this._root.remove();
	}
}

/** The thin bar above the workbench that shows the Viewer state. */
class StatusBanner {
	private readonly _element: HTMLDivElement;
	private readonly _text: HTMLSpanElement;
	private readonly _link: HTMLAnchorElement;

	constructor(document: Document, hostsUrl: string) {
		this._element = document.createElement('div');
		this._element.className = 'fl-banner';
		this._element.setAttribute('role', 'status');
		this._element.hidden = true;
		this._text = document.createElement('span');
		this._link = document.createElement('a');
		this._link.href = hostsUrl;
		this._link.textContent = localize('remoteAccessViewer.banner.hosts', "Hosts");
		this._element.append(this._text, this._link);
		mainWindow.document.body.appendChild(this._element);
	}

	show(text: string | undefined): void {
		this._element.hidden = !text;
		this._text.textContent = text ?? '';
	}
}

// ---- Sign-in -------------------------------------------------------------------------

interface IViewerAuth {
	getToken(): Promise<string>;
	signOut(): Promise<void>;
}

function loadScript(document: Document, src: string, attributes: Record<string, string>): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const script = document.createElement('script');
		script.src = src;
		script.async = true;
		script.crossOrigin = 'anonymous';
		for (const [name, value] of Object.entries(attributes)) {
			script.setAttribute(name, value);
		}
		script.onload = () => resolve();
		script.onerror = () => reject(new Error('Cannot load the sign-in script.'));
		mainWindow.document.head.appendChild(script);
	});
}

async function signIn(config: IRemoteAccessViewerConfig, view: BootView): Promise<IViewerAuth> {
	if (config.devToken) {
		const token = config.devToken;
		return { getToken: async () => token, signOut: async () => { /* nothing to sign out of */ } };
	}
	const publishableKey = config.clerkPublishableKey!;
	const frontendApi = clerkFrontendApiFromPublishableKey(publishableKey);
	if (!frontendApi) {
		throw new Error(localize('remoteAccessViewer.boot.badConfig', "The Viewer is not configured correctly (config.json)."));
	}
	await loadScript(mainWindow.document, `https://${frontendApi}/npm/@clerk/clerk-js@${CLERK_JS_MAJOR}/dist/clerk.browser.js`, { 'data-clerk-publishable-key': publishableKey });
	const clerk = (globalThis as { Clerk?: IClerk }).Clerk;
	if (!clerk) {
		throw new Error(localize('remoteAccessViewer.boot.noClerk', "The sign-in service did not load. Reload the page."));
	}
	await clerk.load();
	if (!clerk.user) {
		const container = view.signInContainer();
		await new Promise<void>(resolve => {
			const stop = clerk.addListener(({ user }) => {
				if (user) {
					stop();
					resolve();
				}
			});
			clerk.mountSignIn(container, { routing: 'virtual', forceRedirectUrl: location.href, signUpForceRedirectUrl: location.href });
		});
		clerk.unmountSignIn(container);
	}
	return {
		getToken: async () => {
			const token = await clerk.session?.getToken();
			if (!token) {
				throw new Error(localize('remoteAccessViewer.boot.signedOut', "You are signed out. Reload the page to sign in."));
			}
			return token;
		},
		signOut: () => clerk.signOut(),
	};
}

// ---- Relay probe ---------------------------------------------------------------------

interface IProbeResult {
	/** What the Relay said about the Host. Absent when the socket closed first. */
	readonly peer?: IRelayHostPeer;
	readonly closeCode?: number;
}

/** Opens the Viewer socket only to read the Host's version (section 8), then closes it. */
function probeHost(relayUrl: string, token: string, pairId: string): Promise<IProbeResult> {
	return new Promise<IProbeResult>(resolve => {
		let settled = false;
		const socket = new WebSocket(relayUrl);
		const finish = (result: IProbeResult) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
					socket.close(1000);
				}
				resolve(result);
			}
		};
		const timer = setTimeout(() => finish({}), PROBE_TIMEOUT_MS);
		socket.addEventListener('open', () => socket.send(createViewerHello(token, pairId)));
		socket.addEventListener('message', event => {
			const frame = typeof event.data === 'string' ? parseViewerControlFrame(event.data) : undefined;
			if (frame?.t === 'welcome') {
				finish({ peer: frame.peer });
			}
		});
		socket.addEventListener('close', event => finish({ closeCode: event.code }));
	});
}

// ---- Boot ----------------------------------------------------------------------------

const browserFetch: ViewerFetch = (url, init) => fetch(url, { ...init, credentials: 'omit', cache: 'no-store' });

class ViewerBoot {
	private readonly _view = new BootView(mainWindow.document);
	private _api!: RemoteAccessViewerApi;
	private _auth!: IViewerAuth;
	private _store!: RemoteAccessViewerPairStore;
	private _config!: IRemoteAccessViewerConfig;

	constructor(private readonly _environment: IViewerLoaderEnvironment) { }

	async run(): Promise<void> {
		this._view.busy(localize('remoteAccessViewer.boot.loading', "Loading..."));
		const config = parseViewerConfig(this._environment.config, location.hostname);
		if (!config) {
			this._view.fatal(localize('remoteAccessViewer.boot.badConfig', "The Viewer is not configured correctly (config.json)."));
			return;
		}
		this._config = config;
		try {
			this._auth = await signIn(config, this._view);
			this._api = new RemoteAccessViewerApi(config.apiBaseUrl, () => this._auth.getToken(), browserFetch);
			this._store = await RemoteAccessViewerPairStore.open();
		} catch (error) {
			this._view.fatal(error instanceof Error ? error.message : String(error));
			return;
		}

		const code = pairingCodeFromLocation(location.pathname, location.hash);
		if (code) {
			// The secret leaves the address bar before anything else runs.
			history.replaceState(null, '', `/${this._environment.buildVersion}/`);
			const paired = await this._claim(code);
			if (paired) {
				return this._follow(paired);
			}
			return;
		}

		const wantsList = new URLSearchParams(location.search).has('hosts');
		const followAgain = storageGet(() => sessionStorage, FOLLOW_SESSION_KEY) ?? (wantsList ? undefined : storageGet(() => localStorage, LAST_PAIR_KEY));
		storageSet(() => sessionStorage, FOLLOW_SESSION_KEY, undefined);
		if (followAgain && await this._store.get(followAgain)) {
			return this._follow(followAgain);
		}
		await this._showPairs(undefined);
	}

	private async _showPairs(error: string | undefined): Promise<void> {
		this._view.busy(localize('remoteAccessViewer.boot.loadingHosts', "Loading your Hosts..."));
		let pairs: IRemoteAccessPairView[];
		try {
			pairs = await this._api.listPairs();
		} catch (listError) {
			this._view.fatal(listError instanceof Error ? listError.message : String(listError));
			return;
		}
		const keys = new Set((await this._store.list()).map(stored => stored.pairId));
		// Keys of pairs the Relay no longer lists were removed on the Host.
		for (const pairId of keys) {
			if (!pairs.some(pair => pair.pairId === pairId)) {
				await this._store.delete(pairId);
			}
		}
		const rows = pairs.map(pair => ({ pair, status: viewerPairStatus(pair, keys.has(pair.pairId)) }))
			.sort((a, b) => Number(b.status === ViewerPairStatus.Ready) - Number(a.status === ViewerPairStatus.Ready));
		this._view.pairs(rows, error, {
			follow: pair => void this._follow(pair.pairId),
			remove: pair => void this._remove(pair),
			pairWithCode: text => void this._pairWithCode(text),
			signOut: () => void this._signOut(),
		});
	}

	private async _pairWithCode(text: string): Promise<void> {
		const code = parsePairingCode(text);
		if (!code) {
			return this._showPairs(localize('remoteAccessViewer.boot.badCode', "That is not a pairing code. Copy the whole code from the Host's Pair a Viewer dialog."));
		}
		const paired = await this._claim(code);
		if (paired) {
			await this._follow(paired);
		}
	}

	/** Section 5 steps 3 and 4. Returns the pair id, or `undefined` after showing the error. */
	private async _claim(code: IRemoteAccessPairingCode): Promise<string | undefined> {
		this._view.busy(localize('remoteAccessViewer.boot.pairing', "Pairing with the Host..."));
		try {
			const claimed = await claimPairing(this._api, code, defaultViewerLabel(navigator.userAgent));
			await this._store.put({ pairId: claimed.pairId, hostLabel: claimed.hostLabel, pairKey: claimed.pairKey, claimedAt: Date.now() });
			return claimed.pairId;
		} catch (error) {
			await this._showPairs(error instanceof ViewerApiError || error instanceof Error ? error.message : String(error));
			return undefined;
		}
	}

	private async _remove(pair: IRemoteAccessPairView): Promise<void> {
		try {
			await this._api.remove(pair.pairId);
		} catch (error) {
			if (!(error instanceof ViewerApiError) || error.kind !== ViewerApiErrorKind.PairNotFound) {
				return this._showPairs(error instanceof Error ? error.message : String(error));
			}
		}
		await this._store.delete(pair.pairId);
		if (storageGet(() => localStorage, LAST_PAIR_KEY) === pair.pairId) {
			storageSet(() => localStorage, LAST_PAIR_KEY, undefined);
		}
		await this._showPairs(undefined);
	}

	private async _signOut(): Promise<void> {
		storageSet(() => localStorage, LAST_PAIR_KEY, undefined);
		await this._auth.signOut();
		location.replace(`/${this._environment.buildVersion}/`);
	}

	private async _follow(pairId: string): Promise<void> {
		const stored = await this._store.get(pairId);
		if (!stored) {
			return this._showPairs(undefined);
		}
		this._view.busy(localize('remoteAccessViewer.boot.connecting', "Connecting to {0}...", stored.hostLabel));
		let probe: IProbeResult;
		try {
			probe = await probeHost(this._config.relayUrl, await this._auth.getToken(), pairId);
		} catch (error) {
			this._view.fatal(error instanceof Error ? error.message : String(error));
			return;
		}
		if (probe.closeCode !== undefined && isRemoteAccessViewerRefusal(probe.closeCode)) {
			if (probe.closeCode === RelayCloseCode.Forbidden) {
				await this._store.delete(pairId);
			}
			return this._showPairs(getRemoteAccessViewerCloseMessage(probe.closeCode));
		}
		storageSet(() => localStorage, LAST_PAIR_KEY, pairId);
		const pick = pickBuildForHost(this._environment.buildVersion, probe.peer?.appVersion, this._environment.builds);
		if (pick.pick === ViewerBuildPick.Switch) {
			storageSet(() => sessionStorage, FOLLOW_SESSION_KEY, pairId);
			location.replace(`/${pick.version}/`);
			return;
		}
		await this._bootWorkbench(stored.pairId, stored.hostLabel, stored.pairKey, pick.pick === ViewerBuildPick.Missing ? pick.version : undefined);
	}

	private async _bootWorkbench(pairId: string, hostLabel: string, pairKey: Uint8Array, missingHostVersion: string | undefined): Promise<void> {
		const environment = this._environment;
		const banner = new StatusBanner(mainWindow.document, `/${environment.buildVersion}/?hosts`);
		const versionNote = missingHostVersion
			? localize('remoteAccessViewer.banner.versionMissing', "The Host runs FlowLeap {0}; this Viewer is {1}. Some parts may not work until the Viewer is updated.", missingHostVersion, environment.buildVersion)
			: undefined;
		banner.show(versionNote);

		// The workbench asks "Leave site?" on unload. A build switch is the page's
		// own navigation, so this listener (registered before the workbench's)
		// stops that question for it, and only for it.
		let switchingBuild = false;
		mainWindow.addEventListener('beforeunload', event => {
			if (switchingBuild) {
				event.stopImmediatePropagation();
			}
		});

		const onDidChangeStatus = (status: IRemoteAccessViewerStatus) => {
			if (status.hostAppVersion && !switchingBuild) {
				const pick = pickBuildForHost(environment.buildVersion, status.hostAppVersion, environment.builds);
				if (pick.pick === ViewerBuildPick.Switch) {
					// The Host was updated while the page was open.
					switchingBuild = true;
					storageSet(() => sessionStorage, FOLLOW_SESSION_KEY, pairId);
					location.replace(`/${pick.version}/`);
					return;
				}
			}
			switch (status.state) {
				case RemoteAccessViewerState.HostOffline:
					banner.show(localize('remoteAccessViewer.banner.hostOffline', "Host offline: {0} is closed, asleep or has Remote Access switched off. The Viewer reconnects when it comes back.", hostLabel));
					break;
				case RemoteAccessViewerState.Refused:
				case RemoteAccessViewerState.Disconnected:
					banner.show(status.message);
					break;
				case RemoteAccessViewerState.Connected:
					banner.show(versionNote);
					break;
				case RemoteAccessViewerState.Connecting:
					break;
			}
		};

		const options: IRemoteAccessViewerOptions = {
			relayUrl: this._config.relayUrl,
			pairId,
			pairKey,
			hostLabel,
			buildVersion: environment.buildVersion,
			getToken: () => this._auth.getToken(),
			onDidChangeStatus,
		};

		const stylesheet = mainWindow.document.createElement('link');
		stylesheet.rel = 'stylesheet';
		stylesheet.href = `${environment.fileRoot}vs/sessions/sessions.viewer.main.css`;
		mainWindow.document.head.appendChild(stylesheet);

		let workbench: IViewerWorkbenchModule;
		try {
			workbench = await import(`${environment.fileRoot}vs/sessions/sessions.viewer.main.js`) as IViewerWorkbenchModule;
		} catch (error) {
			this._view.fatal(localize('remoteAccessViewer.boot.loadFailed', "The Viewer did not load. Check the network connection and reload."));
			return;
		}
		this._view.remove();
		workbench.create(mainWindow.document.body, {
			remoteAccessViewer: options,
			workspaceProvider: {
				workspace: undefined,
				trusted: undefined,
				open: async () => false,
				payload: [['isSessionsWindow', 'true']],
			},
		});
	}
}

const loaderEnvironment = (globalThis as { flowleapViewer?: IViewerLoaderEnvironment }).flowleapViewer;
if (loaderEnvironment) {
	void new ViewerBoot(loaderEnvironment).run();
} else {
	mainWindow.document.body.textContent = localize('remoteAccessViewer.boot.noLoader', "Open the Viewer from its address, not from a build folder.");
}
