/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFileSystemService } from '../../../../platform/filesystem/common/fileSystemService';
import { FileType } from '../../../../platform/filesystem/common/fileTypes';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { URI } from '../../../../util/vs/base/common/uri';
import { IFolderRepositoryManager } from '../../../chatSessions/common/folderRepositoryManager';

// #region Slug Computation

/**
 * Compute the workspace slug from a folder URI.
 * Matches the Claude Code slug format.
 *
 * @example
 * // Windows: drive letter is uppercased, path separators become hyphens
 * '/c:/Users/test/project' → 'C--Users-test-project'
 *
 * // macOS/Linux: leading slash becomes hyphen, path separators become hyphens
 * '/Users/test/project' → '-Users-test-project'
 */
export function computeFolderSlug(folderUri: URI): string {
	return folderUri.path
		.replace(/^\/([a-z]):/i, (_, driveLetter: string) => driveLetter.toUpperCase() + '-')
		.replace(/[\/ .]/g, '-');
}

// #endregion

// #region Project Folder Discovery

export interface ProjectFolder {
	readonly slug: string;
	readonly folderUri: URI;
}

/**
 * Get the project directory slugs to scan for sessions, along with their
 * original folder URIs (needed for badge display).
 *
 * - Single-root: slug for that one folder
 * - Multi-root: slug for every workspace folder
 * - Empty workspace: slug for every folder known to the folder repository manager
 */
export async function getProjectFolders(
	workspace: IWorkspaceService,
	folderRepositoryManager: IFolderRepositoryManager
): Promise<ProjectFolder[]> {
	const folders = workspace.getWorkspaceFolders();

	if (folders.length > 0) {
		return folders.map(folder => ({ slug: computeFolderSlug(folder), folderUri: folder }));
	}

	// Empty workspace: use all known folders from the folder repository manager
	const mruEntries = await folderRepositoryManager.getFolderMRU();
	if (mruEntries.length > 0) {
		return mruEntries.map(entry => ({ slug: computeFolderSlug(entry.folder), folderUri: entry.folder }));
	}

	return [];
}

// #endregion

// #region Session Working Directory Recovery

/**
 * A working directory is usable as a Claude SDK launch cwd only if it is a
 * concrete path — not empty, not the filesystem root, not ".". Launching the SDK
 * with a root/empty cwd makes it write the transcript under a "-" project
 * directory, which breaks resume for every subsequent turn.
 */
export function isUsableSessionCwd(cwd: string | undefined): cwd is string {
	if (!cwd) {
		return false;
	}
	const trimmed = cwd.trim();
	return trimmed.length > 0 && trimmed !== '/' && trimmed !== '.';
}

/** One project directory that holds a transcript for a session. */
interface SessionTranscriptMatch {
	readonly projectDir: string;
	readonly cwd: string | undefined;
	readonly size: number;
}

/** Result of scanning all project directories for a session's transcript. */
export interface SessionCwdLookup {
	/** Best usable working directory recorded in a transcript for this session, if any. */
	readonly cwd: string | undefined;
	/** Names of the project directories that were scanned. */
	readonly searchedProjectDirs: readonly string[];
	/** Every project dir that contained a transcript for this session, newest/largest first. */
	readonly matches: readonly SessionTranscriptMatch[];
}

function extractRecordedCwd(content: string): string | undefined {
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		try {
			const parsed = JSON.parse(trimmed) as { cwd?: unknown };
			if (typeof parsed.cwd === 'string' && parsed.cwd.length > 0) {
				return parsed.cwd;
			}
		} catch {
			// Ignore malformed lines and keep scanning.
		}
	}
	return undefined;
}

/**
 * Finds the working directory a Claude session was created in by scanning every
 * `~/.claude/projects/<slug>/` directory for that session's transcript and
 * reading the `cwd` it recorded. Unlike deriving the project dir from the current
 * workspace, this is immune to a cold or incorrect workspace-cwd guess — which is
 * exactly what makes it safe to resume against.
 *
 * When several project dirs contain a transcript for the id (e.g. a real
 * conversation plus a tiny recovery stub written under a "-" dir from a root
 * cwd), the largest transcript that recorded a usable cwd wins; stubs whose
 * recorded cwd is root/empty are ignored.
 */
export async function findRecordedCwdForSession(
	fileSystem: IFileSystemService,
	userHome: URI,
	sessionId: string,
): Promise<SessionCwdLookup> {
	const projectsDir = URI.joinPath(userHome, '.claude', 'projects');
	let entries: [string, FileType][];
	try {
		entries = await fileSystem.readDirectory(projectsDir);
	} catch {
		return { cwd: undefined, searchedProjectDirs: [], matches: [] };
	}

	const searchedProjectDirs: string[] = [];
	const matches: SessionTranscriptMatch[] = [];
	for (const [name, type] of entries) {
		if (type !== FileType.Directory) {
			continue;
		}
		searchedProjectDirs.push(name);
		const transcript = URI.joinPath(projectsDir, name, `${sessionId}.jsonl`);
		let bytes: Uint8Array;
		try {
			bytes = await fileSystem.readFile(transcript);
		} catch {
			continue; // No transcript for this session in this project dir.
		}
		const content = new TextDecoder().decode(bytes);
		matches.push({ projectDir: name, cwd: extractRecordedCwd(content), size: bytes.byteLength });
	}

	matches.sort((a, b) => b.size - a.size);
	const bestUsable = matches.find(m => isUsableSessionCwd(m.cwd));
	return { cwd: bestUsable?.cwd, searchedProjectDirs, matches };
}

// #endregion
