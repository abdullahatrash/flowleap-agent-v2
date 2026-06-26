/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync } from 'fs';

/**
 * Complete list of directories where npm should be executed to install node modules
 */
export const dirs = [
	'',
	'build',
	'build/rspack',
	'build/vite',
	'extensions',
	'extensions/configuration-editing',
	'extensions/copilot',
	'extensions/css-language-features',
	'extensions/css-language-features/server',
	'extensions/docx-viewer',
	'extensions/emmet',
	'extensions/extension-editing',
	'extensions/flowleap',
	'extensions/git',
	'extensions/git-base',
	'extensions/github',
	'extensions/github-authentication',
	'extensions/html-language-features',
	'extensions/html-language-features/server',
	'extensions/ipynb',
	'extensions/json-language-features',
	'extensions/json-language-features/server',
	'extensions/markdown-language-features',
	'extensions/markdown-math',
	'extensions/media-preview',
	'extensions/merge-conflict',
	'extensions/mermaid-markdown-features',
	'extensions/notebook-renderers',
	'extensions/pdf-preview',
	'extensions/references-view',
	'extensions/search-result',
	'extensions/simple-browser',
	'extensions/terminal-suggest',
	'extensions/typescript-language-features',
	'remote',
	'remote/web',
	'test/automation',
	'test/integration/browser',
	'test/monaco',
	'test/smoke',
	'test/mcp',
	'.vscode/extensions/vscode-selfhost-import-aid',
	'.vscode/extensions/vscode-selfhost-test-provider',
	'.vscode/extensions/vscode-extras',
	'.vscode/extensions/vscode-pr-pinger',
];

if (existsSync(`${import.meta.dirname}/../../.build/distro/npm`)) {
	dirs.push('.build/distro/npm');
	dirs.push('.build/distro/npm/remote');
	dirs.push('.build/distro/npm/remote/web');
}
