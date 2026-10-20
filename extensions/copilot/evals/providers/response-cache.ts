/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A disk cache of model responses for the eval providers (issue #831).
 *
 * promptfoo caches only the calls that go through its own provider classes; a `file://`
 * provider that calls `fetch` itself is outside that path. This module gives such a provider
 * the same behaviour: an identical request (same model, messages, tools and sampling
 * parameters) replays the stored response, so an assert-only rerun of a suite costs no
 * model call.
 *
 * `--no-cache` must bypass it, as it bypasses promptfoo's cache, so that the repeat gates
 * stay independent draws. promptfoo does not pass that flag to a custom provider: the CLI
 * calls `disableCache()` on its own bundle's cache module, and `import { cache } from
 * 'promptfoo'` inside a provider resolves to a second copy of that module. The launcher
 * (`scripts/promptfoo.ts`) therefore turns `--no-cache` into `PROMPTFOO_CACHE_ENABLED=false`
 * for the child process, the env flag promptfoo itself honours, and {@link isResponseCacheEnabled}
 * reads it. A `bustCache` context from promptfoo is honoured as well.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** The values promptfoo's own `getEnvBool` reads as true. Anything else that is set means off. */
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'yup', 'yeppers']);

/** 14 days, promptfoo's own default TTL. */
const DEFAULT_MAX_AGE_MS = 14 * 24 * 3600 * 1000;

/** True unless `PROMPTFOO_CACHE_ENABLED` is set to a non-true value or the call carries `bustCache`. */
export function isResponseCacheEnabled(env: NodeJS.ProcessEnv, context?: { readonly bustCache?: boolean }): boolean {
	if (context?.bustCache) {
		return false;
	}
	const flag = env.PROMPTFOO_CACHE_ENABLED;
	return flag === undefined || flag === '' || TRUE_VALUES.has(flag.toLowerCase());
}

/**
 * The env for a promptfoo child process: `--no-cache` among the args becomes
 * `PROMPTFOO_CACHE_ENABLED=false`, which both promptfoo and the providers honour.
 */
export function cacheFlagEnv(args: readonly string[], env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return args.includes('--no-cache') ? { ...env, PROMPTFOO_CACHE_ENABLED: 'false' } : env;
}

/** One stored response. */
interface CacheEntry<T> {
	readonly createdAt: number;
	readonly value: T;
}

/** Collaborators overridden only by tests. */
export interface ResponseCacheDeps {
	/** The clock, in ms since the epoch. */
	readonly now?: () => number;
	/** Entries older than this are misses and are removed. Default 14 days. */
	readonly maxAgeMs?: number;
}

/**
 * One JSON file per request under `dir`, named by the SHA-256 of the request body. Age-bounded:
 * a read past `maxAgeMs` is a miss, and the first write of a process removes every expired file.
 */
export class ResponseCache {
	private readonly now: () => number;
	private readonly maxAgeMs: number;
	private pruned = false;

	constructor(private readonly dir: string, deps?: ResponseCacheDeps) {
		this.now = deps?.now ?? Date.now;
		this.maxAgeMs = deps?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
	}

	/** The stored value for this request body, or undefined on a miss or an expired entry. */
	get<T>(body: unknown): T | undefined {
		const file = this.fileFor(body);
		let entry: CacheEntry<T>;
		try {
			entry = JSON.parse(fs.readFileSync(file, 'utf-8')) as CacheEntry<T>;
		} catch {
			return undefined;
		}
		if (this.isExpired(entry.createdAt)) {
			fs.rmSync(file, { force: true });
			return undefined;
		}
		return entry.value;
	}

	/** Stores the value for this request body. */
	set<T>(body: unknown, value: T): void {
		fs.mkdirSync(this.dir, { recursive: true });
		this.pruneOnce();
		const entry: CacheEntry<T> = { createdAt: this.now(), value };
		fs.writeFileSync(this.fileFor(body), JSON.stringify(entry));
	}

	private fileFor(body: unknown): string {
		const key = createHash('sha256').update(JSON.stringify(body)).digest('hex');
		return path.join(this.dir, `${key}.json`);
	}

	private isExpired(createdAt: number): boolean {
		return typeof createdAt !== 'number' || this.now() - createdAt > this.maxAgeMs;
	}

	private pruneOnce(): void {
		if (this.pruned) {
			return;
		}
		this.pruned = true;
		for (const name of fs.readdirSync(this.dir)) {
			const file = path.join(this.dir, name);
			try {
				const entry = JSON.parse(fs.readFileSync(file, 'utf-8')) as CacheEntry<unknown>;
				if (this.isExpired(entry.createdAt)) {
					fs.rmSync(file, { force: true });
				}
			} catch {
				fs.rmSync(file, { force: true });
			}
		}
	}
}
