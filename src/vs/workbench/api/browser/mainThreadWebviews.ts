/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { Schemas } from '../../../base/common/network.js';
import { isWeb } from '../../../base/common/platform.js';
import { escape } from '../../../base/common/strings.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { ExtensionIdentifier } from '../../../platform/extensions/common/extensions.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { IURLService } from '../../../platform/url/common/url.js';
import { IWebview, WebviewContentOptions, WebviewExtensionDescription } from '../../contrib/webview/browser/webview.js';
import { IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { SerializableObjectWithBuffers } from '../../services/extensions/common/proxyIdentifier.js';
import * as extHostProtocol from '../common/extHost.protocol.js';
import { deserializeWebviewMessage, serializeWebviewMessage } from '../common/extHostWebviewMessaging.js';

const standardSupportedLinkSchemes = new Set([
	Schemas.http,
	Schemas.https,
	Schemas.mailto,
	Schemas.vscode,
	'vscode-insider',
]);

/**
 * How a link clicked in an extension webview is opened:
 * - `opener`: through the opener service.
 * - `urlHandler`: a link in the product's own URL scheme (for example `flowleap://<extension id>/…`)
 *   in the web client. It goes to the URL service as untrusted, so the extension URL handler asks
 *   before it opens the link, as it does on desktop. The web opener for that scheme marks every link
 *   as trusted, which would let a link in any webview reach any extension without that question.
 * - `undefined`: the link is refused.
 */
export function getWebviewLinkRoute(link: URI, contentOptions: WebviewContentOptions, productUrlProtocol: string | undefined, web: boolean): 'opener' | 'urlHandler' | undefined {
	if (standardSupportedLinkSchemes.has(link.scheme)) {
		return 'opener';
	}

	if (productUrlProtocol === link.scheme) {
		return web ? 'urlHandler' : 'opener';
	}

	if (link.scheme === Schemas.command) {
		if (Array.isArray(contentOptions.enableCommandUris)) {
			return contentOptions.enableCommandUris.includes(link.path) ? 'opener' : undefined;
		}

		return contentOptions.enableCommandUris === true ? 'opener' : undefined;
	}

	return undefined;
}

export class MainThreadWebviews extends Disposable implements extHostProtocol.MainThreadWebviewsShape {

	private readonly _proxy: extHostProtocol.ExtHostWebviewsShape;

	private readonly _webviews = new Map<string, IWebview>();

	constructor(
		context: IExtHostContext,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IProductService private readonly _productService: IProductService,
		@IURLService private readonly _urlService: IURLService,
	) {
		super();

		this._proxy = context.getProxy(extHostProtocol.ExtHostContext.ExtHostWebviews);
	}

	public addWebview(handle: extHostProtocol.WebviewHandle, webview: IWebview, options: { serializeBuffersForPostMessage: boolean }): void {
		if (this._webviews.has(handle)) {
			throw new Error('Webview already registered');
		}

		this._webviews.set(handle, webview);
		this.hookupWebviewEventDelegate(handle, webview, options);
	}

	public $setHtml(handle: extHostProtocol.WebviewHandle, value: string): void {
		this.tryGetWebview(handle)?.setHtml(value);
	}

	public $setOptions(handle: extHostProtocol.WebviewHandle, options: extHostProtocol.IWebviewContentOptions): void {
		const webview = this.tryGetWebview(handle);
		if (webview) {
			webview.contentOptions = reviveWebviewContentOptions(options);
		}
	}

	public async $postMessage(handle: extHostProtocol.WebviewHandle, jsonMessage: string, ...buffers: VSBuffer[]): Promise<boolean> {
		const webview = this.tryGetWebview(handle);
		if (!webview) {
			return false;
		}
		const { message, arrayBuffers } = deserializeWebviewMessage(jsonMessage, buffers);
		return webview.postMessage(message, arrayBuffers);
	}

	private hookupWebviewEventDelegate(handle: extHostProtocol.WebviewHandle, webview: IWebview, options: { serializeBuffersForPostMessage: boolean }) {
		const disposables = new DisposableStore();

		disposables.add(webview.onDidClickLink((uri) => this.onDidClickLink(handle, uri)));

		disposables.add(webview.onMessage((message) => {
			const serialized = serializeWebviewMessage(message.message, options);
			this._proxy.$onMessage(handle, serialized.message, new SerializableObjectWithBuffers(serialized.buffers));
		}));

		disposables.add(webview.onMissingCsp((extension: ExtensionIdentifier) => this._proxy.$onMissingCsp(handle, extension.value)));

		disposables.add(webview.onDidDispose(() => {
			disposables.dispose();
			this._webviews.delete(handle);
		}));
	}

	private onDidClickLink(handle: extHostProtocol.WebviewHandle, link: string): void {
		const webview = this.getWebview(handle);
		const uri = URI.parse(link);
		switch (getWebviewLinkRoute(uri, webview.contentOptions, this._productService.urlProtocol, isWeb)) {
			case 'opener':
				this._openerService.open(link, { fromUserGesture: true, allowContributedOpeners: true, allowCommands: Array.isArray(webview.contentOptions.enableCommandUris) || webview.contentOptions.enableCommandUris === true, fromWorkspace: true });
				break;
			case 'urlHandler':
				this._urlService.open(uri, { trusted: false });
				break;
		}
	}

	private tryGetWebview(handle: extHostProtocol.WebviewHandle): IWebview | undefined {
		return this._webviews.get(handle);
	}

	private getWebview(handle: extHostProtocol.WebviewHandle): IWebview {
		const webview = this.tryGetWebview(handle);
		if (!webview) {
			throw new Error(`Unknown webview handle:${handle}`);
		}
		return webview;
	}

	public getWebviewResolvedFailedContent(viewType: string) {
		return `<!DOCTYPE html>
		<html>
			<head>
				<meta http-equiv="Content-type" content="text/html;charset=UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none';">
			</head>
			<body>${localize('errorMessage', "An error occurred while loading view: {0}", escape(viewType))}</body>
		</html>`;
	}
}

export function reviveWebviewExtension(extensionData: extHostProtocol.WebviewExtensionDescription): WebviewExtensionDescription {
	return {
		id: extensionData.id,
		location: URI.revive(extensionData.location),
	};
}

export function reviveWebviewContentOptions(webviewOptions: extHostProtocol.IWebviewContentOptions): WebviewContentOptions {
	return {
		allowScripts: webviewOptions.enableScripts,
		allowForms: webviewOptions.enableForms,
		forwardUntrustedKeypressEvents: true, // This is always enabled for extensions
		enableCommandUris: webviewOptions.enableCommandUris,
		localResourceRoots: Array.isArray(webviewOptions.localResourceRoots) ? webviewOptions.localResourceRoots.map(r => URI.revive(r)) : undefined,
		portMapping: webviewOptions.portMapping,
	};
}
