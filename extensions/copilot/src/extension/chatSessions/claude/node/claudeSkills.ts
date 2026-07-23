/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Uri } from 'vscode';
import { IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { INativeEnvService } from '../../../../platform/env/common/envService';
import { IPromptsService } from '../../../../platform/promptFiles/common/promptsService';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { createServiceIdentifier } from '../../../../util/common/services';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { Disposable } from '../../../../util/vs/base/common/lifecycle';
import { ResourceMap, ResourceSet } from '../../../../util/vs/base/common/map';
import { Schemas } from '../../../../util/vs/base/common/network';
import { basename, dirname } from '../../../../util/vs/base/common/resources';
import { URI } from '../../../../util/vs/base/common/uri';
import { resolveSkillConfigLocations } from '../../common/skillConfigLocations';

/** The Claude SDK loads `.claude` directories automatically — skip them to avoid duplicates. */
function isClaudeDirectory(uri: URI): boolean {
	return uri.path.split('/').includes('.claude');
}

/**
 * Builds a Claude SDK plugin root that exposes only a chosen subset of a bundled
 * skills root's skills.
 *
 * A bundled root exposes *every* `skills/<name>` subdirectory it contains, so a
 * colliding skill cannot be removed by dropping the root without taking its
 * non-colliding siblings with it. This seam materializes a filtered root instead.
 * It is injected so unit tests can observe the surviving set without touching disk.
 */
export interface ISkillRootMaterializer {
	readonly _serviceBrand: undefined;
	/**
	 * @param nameHint Basename to give the materialized root — becomes the Claude
	 * SDK plugin name, so keep it aligned with the original root's basename.
	 * @param skillDirs Absolute skill directories (each the parent of a `SKILL.md`)
	 * to expose under the materialized root's `skills/` directory.
	 * @returns A directory suitable as a Claude SDK local plugin root.
	 */
	materialize(nameHint: string, skillDirs: readonly URI[]): Promise<URI>;
}

/**
 * Default {@link ISkillRootMaterializer} that builds a directory-symlink farm
 * under the OS temp directory. Farms are content-addressed by their surviving
 * skill set so repeated calls with the same inputs reuse one directory, keeping
 * the footprint bounded without any disposal bookkeeping.
 */
export class NodeSkillRootMaterializer implements ISkillRootMaterializer {
	declare _serviceBrand: undefined;

	private readonly _base = join(tmpdir(), 'flowleap-session-skills');

	async materialize(nameHint: string, skillDirs: readonly URI[]): Promise<URI> {
		const safeName = nameHint.replace(/[^a-zA-Z0-9._-]/g, '_') || 'skills';
		const fsPaths = skillDirs.map(dir => dir.fsPath).sort();
		const key = createHash('sha256').update(fsPaths.join('\0')).digest('hex').substring(0, 16);
		const root = join(this._base, key, safeName);
		const skillsDir = join(root, 'skills');

		// Rebuild the skills/ directory from scratch so a reused farm can never
		// retain a symlink to a skill that has since been dropped.
		await fs.rm(skillsDir, { recursive: true, force: true });
		await fs.mkdir(skillsDir, { recursive: true });
		for (const dir of skillDirs) {
			// 'junction' is a Windows directory link that needs no elevation and is
			// ignored (falling back to a regular symlink) on other platforms.
			await fs.symlink(dir.fsPath, join(skillsDir, basename(dir)), 'junction');
		}
		return URI.file(root);
	}
}

export interface IClaudePluginService {
	readonly _serviceBrand: undefined;
	/**
	 * Returns plugin root directories suitable for the Claude SDK's `plugins` option.
	 *
	 * Combines two sources:
	 * 1. **Skills** — discovered as directories containing `SKILL.md` files, but the Claude SDK
	 *    plugin loader expects the *parent* of the `skills/` directory (the plugin root),
	 *    so we walk one level up from each skill location.
	 * 2. **Plugins** — returned directly by the prompts service as actual plugin root directories.
	 *
	 * When a fresher channel (an installed plugin, or a user/workspace skill —
	 * which includes the harness `~/.claude/skills` copies) provides a skill with
	 * the same name as the app's built-in copy, only the fresher copy is exposed:
	 * fresher channels update out of band with the app (issue #162).
	 */
	getPluginLocations(token: CancellationToken): Promise<Uri[]>;
}

export const IClaudePluginService = createServiceIdentifier<IClaudePluginService>('IClaudePluginService');

export class ClaudePluginService extends Disposable implements IClaudePluginService {
	declare _serviceBrand: undefined;

	constructor(
		private readonly materializer: ISkillRootMaterializer,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INativeEnvService private readonly envService: INativeEnvService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IPromptsService private readonly promptsService: IPromptsService,
	) {
		super();
	}

	async getPluginLocations(token: CancellationToken): Promise<Uri[]> {
		const pluginRoots = new ResourceSet();

		// #region Skill config locations as plugin roots
		// Skill locations point to directories containing skill subdirectories (e.g. .../skills/).
		// The Claude SDK plugin loader expects the parent of the skills/ directory, so we
		// walk one level up from each location.
		for (const uri of resolveSkillConfigLocations(this.configurationService, this.envService, this.workspaceService)) {
			pluginRoots.add(dirname(uri));
		}
		// #endregion

		// #region Skills as plugin roots
		const skills = (await this.promptsService.getSkills(token)).filter(s => s.uri.scheme === Schemas.file);

		// Any skill the model already gets from a fresher channel — an installed
		// plugin, or a user/workspace skill (which includes the harness
		// `~/.claude/skills` copies, refreshed out of band) — supersedes the app's
		// built-in copy of the same name. Fresher channels win the upstream name
		// de-duplication, so their names are always visible here even when the
		// built-in namesake is hidden (issue #162).
		const fresherNames = new Set(
			skills
				.filter(s => s.source === 'user' || s.source === 'local' || s.source === 'plugin')
				.map(s => s.name)
		);

		// Built-in skills collapse to a single shared root (e.g. every built-in
		// session skill lives under one `skills/` directory). Passing that root whole
		// would re-expose every skill it contains on disk — including ones the upstream
		// de-duplication hid because a fresher copy exists — so we rebuild the root from
		// only the surviving built-in skill directories. Every other source (user,
		// workspace, plugin, config) is already the fresh copy and passes through as-is.
		const builtinSurvivors = new ResourceMap<URI[]>();
		for (const skill of skills) {
			// Extension-contributed skills (the patent skills bundled via `chatSkills`)
			// instruct the model to call panel-chat language-model tools (search_patents,
			// patent_api_request, …) that do not exist in Claude SDK sessions, so they
			// must never become session plugins.
			if (skill.source === 'extension') {
				continue;
			}
			const root = dirname(dirname(dirname(skill.uri)));
			if (isClaudeDirectory(root)) {
				continue;
			}
			if (skill.source !== 'builtin') {
				// A fresh copy — pass its root straight through.
				pluginRoots.add(root);
				continue;
			}
			// Built-in: keep it only if no fresher channel provides the same name.
			let survivors = builtinSurvivors.get(root);
			if (!survivors) {
				survivors = [];
				builtinSurvivors.set(root, survivors);
			}
			if (!fresherNames.has(skill.name)) {
				survivors.push(dirname(skill.uri));
			}
		}

		for (const [root, survivors] of builtinSurvivors) {
			if (fresherNames.size === 0) {
				// Nothing fresher exists anywhere, so the built-in root hides nothing
				// and collides with nothing — expose it whole.
				pluginRoots.add(root);
			} else if (survivors.length > 0) {
				// Rebuild the root exposing only the surviving built-in skills.
				pluginRoots.add(await this.materializer.materialize(basename(root), survivors));
			}
			// else: every built-in skill in this root is superseded — drop it entirely.
		}
		// #endregion

		// #region Plugin roots from prompts service
		(await this.promptsService.getPlugins(token))
			.filter(p => p.uri.scheme === Schemas.file)
			.filter(p => !isClaudeDirectory(p.uri))
			.map(p => p.uri)
			.forEach(uri => pluginRoots.add(uri));
		// #endregion

		return Array.from(pluginRoots);
	}
}
