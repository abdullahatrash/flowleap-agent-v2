/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Notify-only update checker for the FlowLeap fork.
 *
 * The fork does NOT use VS Code's native (Squirrel/Inno) auto-updater. Instead
 * this polls the website's `/api/latest-version` endpoint, compares the latest
 * published release against this build's stamped version, and — when newer —
 * shows a toast that links the user to the download page. It can never rewrite
 * the installed app, so it cannot break an installation; the user downloads and
 * reinstalls manually (the Cursor / Claude-desktop style "update available" UX).
 *
 * The build's identity comes from this extension's `package.json` version,
 * which the release workflow stamps from the git tag. In development (or an
 * unstamped placeholder build) the check is skipped so it never nags.
 */

/** Base URL of the FlowLeap website; override with `FLOWLEAP_SITE_URL` for staging. */
const DEFAULT_SITE_URL = 'https://www.flowleap.co';

/** Placeholder versions that indicate an unstamped (dev) build — never check against these. */
const PLACEHOLDER_VERSIONS = new Set(['0.0.0', '0.0.1']);

const FIRST_CHECK_DELAY_MS = 30 * 1000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // every 4 hours while running
const REQUEST_TIMEOUT_MS = 10 * 1000;

const SKIPPED_VERSION_KEY = 'flowleap.update.skippedVersion';

/** The `/api/latest-version` response shape (see the website's `latest-version` service). */
interface ILatestVersion {
	readonly version: string;
	readonly notes: string;
	readonly pubDate: string;
	readonly downloadUrl: string;
	readonly notesUrl: string;
}

/**
 * Starts the periodic update check and registers the manual
 * `flowleap.checkForUpdates` command. Returns a disposable that stops the timer.
 */
export function registerUpdateNotifier(context: vscode.ExtensionContext): vscode.Disposable {
	const notifier = new UpdateNotifier(context);
	notifier.start();
	return notifier;
}

class UpdateNotifier implements vscode.Disposable {

	private timer: NodeJS.Timeout | undefined;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly siteUrl: string;
	private readonly currentVersion: string;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.siteUrl = (process.env.FLOWLEAP_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, '');
		this.currentVersion = String(context.extension.packageJSON.version ?? '');

		// Manual "Check for Updates" — always available, even in dev.
		this.disposables.push(
			vscode.commands.registerCommand('flowleap.checkForUpdates', () => this.check(true))
		);
	}

	start(): void {
		// Skip automatic checks for dev / unstamped builds so we never nag locally.
		if (this.context.extensionMode !== vscode.ExtensionMode.Production || this.isPlaceholderBuild()) {
			console.log('FlowLeap update notifier: automatic checks disabled (dev or unstamped build)');
			return;
		}

		const first = setTimeout(() => {
			void this.check(false);
			this.timer = setInterval(() => void this.check(false), CHECK_INTERVAL_MS);
		}, FIRST_CHECK_DELAY_MS);

		// Allow the process to exit without waiting on these timers.
		first.unref?.();
		this.disposables.push({ dispose: () => clearTimeout(first) });
	}

	private isPlaceholderBuild(): boolean {
		return !this.currentVersion || PLACEHOLDER_VERSIONS.has(this.currentVersion);
	}

	/**
	 * Performs one update check. `explicit` is true for the manual command,
	 * which surfaces "you're up to date" and ignores the skipped-version filter.
	 */
	private async check(explicit: boolean): Promise<void> {
		if (!explicit && this.isPlaceholderBuild()) {
			return;
		}

		let latest: ILatestVersion | undefined;
		try {
			latest = await this.fetchLatest();
		} catch (error) {
			console.log('FlowLeap update notifier: check failed', error);
			if (explicit) {
				vscode.window.showWarningMessage('Could not check for FlowLeap updates. Please try again later.');
			}
			return;
		}

		if (!latest) {
			if (explicit) {
				vscode.window.showInformationMessage('No FlowLeap releases are published yet.');
			}
			return;
		}

		if (!explicit && this.currentVersion && compareVersions(latest.version, this.currentVersion) <= 0) {
			return; // already current
		}

		if (compareVersions(latest.version, this.currentVersion) <= 0) {
			if (explicit) {
				vscode.window.showInformationMessage(`FlowLeap is up to date (v${this.currentVersion}).`);
			}
			return;
		}

		// A newer version exists. Honor a prior "Skip This Version" for background checks.
		const skipped = this.context.globalState.get<string>(SKIPPED_VERSION_KEY);
		if (!explicit && skipped === latest.version) {
			return;
		}

		await this.promptUpdate(latest);
	}

	private async promptUpdate(latest: ILatestVersion): Promise<void> {
		const download = 'Download';
		const releaseNotes = 'Release Notes';
		const skip = 'Skip This Version';

		const choice = await vscode.window.showInformationMessage(
			`FlowLeap v${latest.version} is available. You're on v${this.currentVersion}.`,
			download,
			releaseNotes,
			skip
		);

		if (choice === download) {
			void vscode.env.openExternal(vscode.Uri.parse(latest.downloadUrl));
		} else if (choice === releaseNotes) {
			void vscode.env.openExternal(vscode.Uri.parse(latest.notesUrl));
		} else if (choice === skip) {
			await this.context.globalState.update(SKIPPED_VERSION_KEY, latest.version);
		}
	}

	private async fetchLatest(): Promise<ILatestVersion | undefined> {
		const lang = encodeURIComponent(vscode.env.language || 'en');
		const url = `${this.siteUrl}/api/latest-version?lang=${lang}`;

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			const response = await fetch(url, {
				signal: controller.signal,
				headers: { 'Accept': 'application/json', 'User-Agent': `FlowLeap/${this.currentVersion}` }
			});

			if (response.status === 204) {
				return undefined; // no release published yet
			}
			if (!response.ok) {
				throw new Error(`Unexpected status ${response.status}`);
			}

			const data = await response.json() as Partial<ILatestVersion>;
			if (!data || typeof data.version !== 'string' || typeof data.downloadUrl !== 'string') {
				throw new Error('Malformed latest-version response');
			}
			return {
				version: data.version,
				notes: data.notes ?? '',
				pubDate: data.pubDate ?? '',
				downloadUrl: data.downloadUrl,
				notesUrl: data.notesUrl ?? data.downloadUrl
			};
		} finally {
			clearTimeout(timeout);
		}
	}

	dispose(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables.length = 0;
	}
}

/**
 * Compares two dotted versions (e.g. `1.0.4`), ignoring any pre-release suffix
 * after a `-`. Returns a negative number when `a < b`, positive when `a > b`,
 * and 0 when their numeric parts are equal.
 */
export function compareVersions(a: string, b: string): number {
	const parse = (v: string): number[] => v.split('-')[0].split('.').map(part => parseInt(part, 10) || 0);
	const pa = parse(a);
	const pb = parse(b);
	const length = Math.max(pa.length, pb.length);
	for (let i = 0; i < length; i++) {
		const da = pa[i] ?? 0;
		const db = pb[i] ?? 0;
		if (da !== db) {
			return da - db;
		}
	}
	return 0;
}
