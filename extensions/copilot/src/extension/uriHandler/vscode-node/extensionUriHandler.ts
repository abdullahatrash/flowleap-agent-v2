/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IDisposable, toDisposable } from '../../../util/vs/base/common/lifecycle';

// VS Code permits only ONE `vscode.window.registerUriHandler` per extension — a second call
// throws "Protocol handler already registered". This module owns that single registration for
// the extension and routes each incoming system URI to the matching consumer:
//   - path routes (e.g. the FlowLeap auth callback at `/callback`) are matched first;
//   - anything unmatched goes to the default handler (the copilot-debug pipe handler).
// Routing by path (not fan-out) is required: the debug handler treats an unknown path as a
// socket pipe to connect to, so it must never receive the auth callback, and vice versa.

interface IUriRoute {
	readonly matches: (uri: vscode.Uri) => boolean;
	readonly handler: vscode.UriHandler;
}

const _routes: IUriRoute[] = [];
let _defaultHandler: vscode.UriHandler | undefined;
let _registration: vscode.Disposable | undefined;

function ensureRegistered(): void {
	if (_registration) {
		return;
	}
	_registration = vscode.window.registerUriHandler({
		handleUri: (uri: vscode.Uri) => {
			const route = _routes.find(r => r.matches(uri));
			const handler = route?.handler ?? _defaultHandler;
			return handler?.handleUri(uri);
		}
	});
}

function disposeIfEmpty(): void {
	if (_routes.length === 0 && !_defaultHandler) {
		_registration?.dispose();
		_registration = undefined;
	}
}

/**
 * Register a handler for system URIs whose path matches {@link matches} (e.g. the FlowLeap
 * `flowleap://…/callback` deep link). Path routes take precedence over the default handler.
 */
export function registerUriRoute(matches: (uri: vscode.Uri) => boolean, handler: vscode.UriHandler): IDisposable {
	const route: IUriRoute = { matches, handler };
	_routes.push(route);
	ensureRegistered();
	return toDisposable(() => {
		const index = _routes.indexOf(route);
		if (index !== -1) {
			_routes.splice(index, 1);
		}
		disposeIfEmpty();
	});
}

/**
 * Register the fallback handler for system URIs that no {@link registerUriRoute} claims.
 * Only one default handler is active at a time.
 */
export function registerDefaultUriHandler(handler: vscode.UriHandler): IDisposable {
	_defaultHandler = handler;
	ensureRegistered();
	return toDisposable(() => {
		if (_defaultHandler === handler) {
			_defaultHandler = undefined;
		}
		disposeIfEmpty();
	});
}
