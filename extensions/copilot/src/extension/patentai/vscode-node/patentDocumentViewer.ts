/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { Disposable, DisposableStore } from '../../../util/vs/base/common/lifecycle';
import { callFacadeTool } from '../../tools/vscode-node/patentFacade';
import { registerUriRoute } from '../../uriHandler/vscode-node/extensionUriHandler';
import { OPEN_PATENT_DOCUMENT_COMMAND, parsePatentDocumentReference, PATENT_DOCUMENT_AUTHORITY, PATENT_DOCUMENT_PATH, PatentDocumentReference } from '../common/patentDocumentReference';
import { IPatentBackendClient } from './patentBackendClient';
import { PatentReaderData, renderPatentDocument } from './patentDocumentHtml';

interface ReaderEntry {
	readonly panel: vscode.WebviewPanel;
	reference: PatentDocumentReference;
	data?: PatentReaderData;
}

interface Bibliography {
	title: string | null;
	applicants: string[];
	abstract: string | null;
	dates: { publication: string | null };
}

/** Auth and data-key handling stay in the existing backend client; the webview never sees tokens. */
export class PatentDocumentViewer extends Disposable {
	private readonly readers = new Map<string, ReaderEntry>();

	constructor(private readonly client: IPatentBackendClient) {
		super();
		this._register(vscode.commands.registerCommand(OPEN_PATENT_DOCUMENT_COMMAND, async (input?: unknown) => {
			if (input === undefined) {
				const number = await vscode.window.showInputBox({ prompt: vscode.l10n.t('Enter a patent publication number'), placeHolder: 'EP1000000A1' });
				if (!number) {
					return;
				}
				input = { publicationNumber: number.replace(/[.\s,/_-]/g, '').toUpperCase(), section: 'bibliography' };
			}
			await this.open(input);
		}));
		this._register(registerUriRoute(uri => uri.authority === PATENT_DOCUMENT_AUTHORITY && uri.path === PATENT_DOCUMENT_PATH, {
			handleUri: async uri => {
				const query = new URLSearchParams(uri.query);
				await this.open({ publicationNumber: query.get('publication'), section: query.get('section'), ...(query.has('claim') ? { claimNumber: query.get('claim') } : {}) });
			},
		}));
	}

	private async open(input: unknown): Promise<void> {
		const reference = parsePatentDocumentReference(input);
		if (!reference) {
			await vscode.window.showErrorMessage(vscode.l10n.t('This patent citation has an invalid document reference.'));
			return;
		}
		const existing = this.readers.get(reference.publicationNumber);
		if (existing) {
			existing.reference = reference;
			existing.panel.reveal(vscode.ViewColumn.Beside);
			if (existing.data) {
				existing.panel.webview.html = renderPatentDocument(reference, randomUUID(), existing.data);
			}
			return;
		}

		const panel = vscode.window.createWebviewPanel('flowleap.patentDocument', reference.publicationNumber, vscode.ViewColumn.Beside, {
			enableScripts: true,
			localResourceRoots: [],
		});
		const lifetime = new DisposableStore();
		lifetime.add(panel);
		const cancellation = lifetime.add(new vscode.CancellationTokenSource());
		const entry: ReaderEntry = { panel, reference };
		this.readers.set(reference.publicationNumber, entry);
		lifetime.add(panel.onDidDispose(() => {
			cancellation.cancel();
			this.readers.delete(reference.publicationNumber);
			lifetime.dispose();
		}));
		panel.webview.html = renderPatentDocument(reference, randomUUID());
		try {
			const input = { patent_number: reference.publicationNumber };
			const [bibliography, claims, description] = await Promise.allSettled([
				callFacadeTool<Bibliography>(this.client, 'get_bibliography', input, cancellation.token),
				callFacadeTool<{ claims: { number: string; text: string }[] }>(this.client, 'get_claims', input, cancellation.token),
				callFacadeTool<{ description: string | null }>(this.client, 'get_description', input, cancellation.token),
			]);
			if (cancellation.token.isCancellationRequested) {
				return;
			}
			if (bibliography.status === 'rejected') {
				throw bibliography.reason;
			}
			entry.data = {
				...bibliography.value,
				publicationDate: bibliography.value.dates?.publication,
				claims: claims.status === 'fulfilled' ? claims.value.claims : [],
				description: description.status === 'fulfilled' ? description.value.description : null,
				claimsError: claims.status === 'rejected' ? this.errorMessage(claims.reason) : undefined,
				descriptionError: description.status === 'rejected' ? this.errorMessage(description.reason) : undefined,
				loadedAt: new Date().toLocaleString(),
			};
			panel.webview.html = renderPatentDocument(entry.reference, randomUUID(), entry.data);
		} catch (error) {
			if (!cancellation.token.isCancellationRequested) {
				panel.webview.html = renderPatentDocument(entry.reference, randomUUID(), undefined, this.errorMessage(error));
			}
		}
	}

	private errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : vscode.l10n.t('The document could not be loaded.');
	}

	override dispose(): void {
		for (const entry of this.readers.values()) {
			entry.panel.dispose();
		}
		super.dispose();
	}
}
