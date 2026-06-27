/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PatentAIConfig } from '../common/config';

/**
 * Resolve the FlowLeap (Patent AI) auth configuration from environment and VS Code settings.
 * Environment variables take precedence over settings.
 *
 * Production defaults:
 * - Backend API: `https://api.flowleap.co/v1`
 * - Frontend:    `https://flowleap.co`
 *
 * For local development, set `PATENT_API_URL=http://localhost:8000/v1`.
 */
export function getPatentAIConfig(): PatentAIConfig {
	const config = vscode.workspace.getConfiguration('patent');

	// Production default — override with env var for local development.
	const apiUrl = process.env.PATENT_API_URL || config.get<string>('apiUrl') || 'https://api.flowleap.co/v1';

	// Backend base URL without the `/v1` suffix (OAuth + billing live outside the versioned API).
	const backendBaseUrl = apiUrl.replace(/\/v1\/?$/, '');

	// Production uses flowleap.co; local dev uses the site on :3000. Override with PATENT_FRONTEND_URL.
	const frontendUrl = process.env.PATENT_FRONTEND_URL
		|| (backendBaseUrl.includes('localhost') ? 'http://localhost:3000' : 'https://flowleap.co');

	return {
		apiUrl,
		clientId: 'patent-ai-agent',
		// Redirects to the website for Clerk sign-in, then back with the Clerk template token.
		// The callback deep link itself is derived in the auth provider via `asExternalUri`.
		authUrl: `${backendBaseUrl}/oauth/authorize`,
		frontendUrl,
	};
}
