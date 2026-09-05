/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { parsePatentDocumentReference, PatentDocumentReference, patentDocumentUri } from '../common/patentDocumentReference';

/** The backend owns the reference; the client chooses its own URI scheme and reader. */
export function patentCitationLink(label: string, reference: PatentDocumentReference | null | undefined): string {
	const valid = parsePatentDocumentReference(reference);
	if (!valid) {
		return label;
	}
	const escapedLabel = label.replace(/[\\\[\]]/g, '\\$&');
	return `[${escapedLabel}](${patentDocumentUri(valid, vscode.env.uriScheme)})`;
}

/** Add reader links to JSON API results before budgeting, so omitted records cannot leak citations. */
export function addPatentReaderLinks(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(addPatentReaderLinks);
	}
	if (!value || typeof value !== 'object') {
		return value;
	}
	const result: Record<string, unknown> = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, addPatentReaderLinks(child)]));
	const reference = parsePatentDocumentReference(result.documentReference);
	if (reference) {
		const label = reference.claimNumber ? `${reference.publicationNumber}, claim ${reference.claimNumber}` : reference.publicationNumber;
		result.readerLink = patentCitationLink(label, reference);
	}
	return result;
}
