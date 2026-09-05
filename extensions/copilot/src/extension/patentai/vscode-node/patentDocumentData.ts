/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { callFacadeTool } from '../../tools/vscode-node/patentFacade';
import { PatentDocumentReference } from '../common/patentDocumentReference';
import { IPatentBackendClient } from './patentBackendClient';
import { PatentReaderData } from './patentDocumentHtml';

interface Bibliography {
	docId: string;
	title: string | null;
	applicants: string[];
	abstract: string | null;
	dates: { publication: string | null };
}

function publicationIdentity(value: string): string {
	const compact = value.replace(/[.\s,/_-]/g, '').toUpperCase();
	// OPS and BigQuery differ in leading zeros in US pre-grant serials. Keep the
	// full kind in this comparison: formatting equivalence must not equate A1/A2.
	const us = compact.match(/^US(?<year>19\d{2}|20\d{2})(?<serial>\d{4,})(?<kind>A\d?)$/);
	return us?.groups ? `US${us.groups.year}${us.groups.serial.replace(/^0+/, '') || '0'}${us.groups.kind}` : compact;
}

function verifyPublication<T extends { docId: string }>(data: T, requested: string): T {
	const returned = typeof data.docId === 'string' ? publicationIdentity(data.docId) : '';
	if (returned !== publicationIdentity(requested)) {
		throw new Error(l10n.t('The backend did not return the requested publication {0}. Its content cannot be shown under this citation. Update the backend if it still removes publication kinds.', requested));
	}
	return data;
}

/** Validate each section's identity before rendering, including responses from older backends. */
export async function loadPatentDocument(client: IPatentBackendClient, reference: PatentDocumentReference, token: CancellationToken): Promise<PatentReaderData> {
	const requested = reference.publicationNumber;
	if (!/^[A-Z]{2}\d+[A-Z]\d?$/.test(requested)) {
		throw new Error(l10n.t('Specify a publication kind, for example EP1234567A2 or EP1234567B1. A citation without a kind cannot identify which claims to show.'));
	}
	const input = { patent_number: requested };
	const read = async <T extends { docId: string }>(tool: string): Promise<T> => verifyPublication(await callFacadeTool<T>(client, tool, input, token), requested);
	const [bibliography, claims, description] = await Promise.allSettled([
		read<Bibliography>('get_bibliography'),
		read<{ docId: string; claims: { number: string; text: string }[] }>('get_claims'),
		read<{ docId: string; description: string | null }>('get_description'),
	]);
	if (bibliography.status === 'rejected') {
		throw bibliography.reason;
	}
	const errorMessage = (error: unknown) => error instanceof Error ? error.message : l10n.t('The document could not be loaded.');
	return {
		...bibliography.value,
		publicationDate: bibliography.value.dates?.publication,
		claims: claims.status === 'fulfilled' ? claims.value.claims : [],
		description: description.status === 'fulfilled' ? description.value.description : null,
		claimsError: claims.status === 'rejected' ? errorMessage(claims.reason) : undefined,
		descriptionError: description.status === 'rejected' ? errorMessage(description.reason) : undefined,
		loadedAt: new Date().toLocaleString(),
	};
}
