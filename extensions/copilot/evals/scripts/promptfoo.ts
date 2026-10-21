/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Launcher for the PINNED promptfoo (evals/package.json), used by every `eval:*` npm script.
 *
 * Why a launcher instead of calling `promptfoo` directly: a bare `promptfoo` — and even
 * `npm exec --no -- promptfoo` — falls back to whatever version happens to sit on PATH
 * (historically a global install), so gate results silently depended on the machine. This
 * resolves evals/node_modules/promptfoo and nothing else: if the pinned install is missing
 * it fails with the fix instead of running an unknown version.
 *
 * promptfoo is spawned with cwd = evals/, because every config path (`file://providers/...`,
 * `outputPath: output/...`) is relative to that directory.
 *
 * `--no-cache` is also passed to the child as `PROMPTFOO_CACHE_ENABLED=false`, because promptfoo
 * does not tell a `file://` provider about the flag and the single-turn provider keeps a response
 * cache of its own (providers/response-cache.ts). Both honour the env flag.
 *
 * Run: npx tsx evals/scripts/promptfoo.ts <promptfoo args...>
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { cacheFlagEnv } from '../providers/response-cache';

const EVALS_DIR = path.dirname(__dirname);
const ENTRYPOINT = path.join(EVALS_DIR, 'node_modules', 'promptfoo', 'dist', 'src', 'entrypoint.js');

if (!fs.existsSync(ENTRYPOINT)) {
	console.error('ERROR: the pinned promptfoo is not installed.');
	console.error('  Install it: npm run eval:setup   (from extensions/copilot)');
	console.error(`  Expected:   ${ENTRYPOINT}`);
	process.exit(1);
}

const result = spawnSync(process.execPath, [ENTRYPOINT, ...process.argv.slice(2)], {
	stdio: 'inherit',
	cwd: EVALS_DIR,
	env: cacheFlagEnv(process.argv.slice(2), process.env)
});

process.exit(result.status ?? 1);
