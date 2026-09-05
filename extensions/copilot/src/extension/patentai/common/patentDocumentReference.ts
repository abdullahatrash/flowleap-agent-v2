/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface PatentDocumentReference {
	readonly publicationNumber: string;
	readonly section: 'bibliography' | 'abstract' | 'claims' | 'description';
	readonly claimNumber?: string;
}

export const OPEN_PATENT_DOCUMENT_COMMAND = 'flowleap.openPatentDocument';
export const PATENT_DOCUMENT_AUTHORITY = 'flowleap.patent-ai';
export const PATENT_DOCUMENT_PATH = '/patent';

/** Validate both backend data and untrusted URI/command input before making a backend request. */
export function parsePatentDocumentReference(value: unknown): PatentDocumentReference | undefined {
	if (!value || typeof value !== 'object' || !('publicationNumber' in value) || !('section' in value)) {
		return undefined;
	}
	const { publicationNumber, section } = value;
	const claimNumber = 'claimNumber' in value ? value.claimNumber : undefined;
	if (typeof publicationNumber !== 'string' || !/^[A-Z]{2}\d{1,16}(?:[A-Z]\d?)?$/.test(publicationNumber)
		|| (section !== 'bibliography' && section !== 'abstract' && section !== 'claims' && section !== 'description')
		|| (claimNumber !== undefined && (section !== 'claims' || typeof claimNumber !== 'string' || !/^[1-9]\d{0,4}$/.test(claimNumber)))) {
		return undefined;
	}
	return { publicationNumber, section, ...(claimNumber ? { claimNumber } : {}) };
}

export function patentDocumentUri(reference: PatentDocumentReference, scheme: string): string {
	const query = new URLSearchParams({ publication: reference.publicationNumber, section: reference.section });
	if (reference.claimNumber) {
		query.set('claim', reference.claimNumber);
	}
	return `${scheme}://${PATENT_DOCUMENT_AUTHORITY}${PATENT_DOCUMENT_PATH}?${query}`;
}

export function patentDocumentTarget(reference: PatentDocumentReference): string {
	return reference.claimNumber ? `claim-${reference.claimNumber}` : reference.section;
}
