/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A single enterprise-managed marketplace entry, preserving the marketplace
 * name (used as `displayLabel`) and the original `source` discriminator.
 */
export type IExtraKnownMarketplaceEntry =
	| { readonly name: string; readonly autoUpdate?: boolean; readonly source: { readonly source: 'github'; readonly repo: string; readonly ref?: string } }
	| { readonly name: string; readonly autoUpdate?: boolean; readonly source: { readonly source: 'git'; readonly url: string; readonly ref?: string } };

export interface IExtraKnownMarketplaceConfigValue {
	readonly source: string;
	readonly autoUpdate: boolean;
}

export type ExtraKnownMarketplacesConfigDict = Record<string, string>;

/**
 * A single entry in the enterprise-managed `strictKnownMarketplaces` allowlist
 * (the `chat.plugins.strictMarketplaces` setting), a discriminated union on
 * `source`. Delivered as JSON via managed settings (the server endpoint or
 * native MDM) and validated at match time, so the optional fields are only
 * meaningful for their corresponding `source`.
 */
export interface IStrictMarketplaceSource {
	readonly source: 'github' | 'git' | 'url' | 'npm' | 'file' | 'directory' | 'hostPattern' | 'pathPattern';
	readonly repo?: string;
	readonly url?: string;
	readonly ref?: string;
	readonly path?: string;
	readonly package?: string;
	readonly hostPattern?: string;
	readonly pathPattern?: string;
	readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Converts an {@link IExtraKnownMarketplaceEntry} array into the
 * policy dict stored on the `chat.plugins.extraMarketplaces`
 * setting (and carried as the canonical JSON value of the `extraKnownMarketplaces`
 * managed setting across both the server endpoint and native MDM delivery).
 *
 * Entries without `autoUpdate` retain the legacy source string. Entries with an
 * explicit override use a JSON-encoded {@link IExtraKnownMarketplaceConfigValue}.
 *
 * Plain-string entries (allowed by the policy schema but unnamed) are stored with
 * the value used as both key and value so they survive the round-trip intact.
 */
export function extraKnownMarketplacesToConfigDict(entries: readonly (string | IExtraKnownMarketplaceEntry)[] | undefined): ExtraKnownMarketplacesConfigDict | undefined {
	if (!entries?.length) {
		return undefined;
	}
	const obj: ExtraKnownMarketplacesConfigDict = {};
	for (const entry of entries) {
		if (typeof entry === 'string') {
			obj[entry] = entry;
		} else {
			const s = entry.source;
			const base = s.source === 'github' ? s.repo : s.url;
			const source = s.ref ? `${base}#${s.ref}` : base;
			obj[entry.name] = entry.autoUpdate === undefined ? source : JSON.stringify({ source, autoUpdate: entry.autoUpdate } satisfies IExtraKnownMarketplaceConfigValue);
		}
	}
	return obj;
}
