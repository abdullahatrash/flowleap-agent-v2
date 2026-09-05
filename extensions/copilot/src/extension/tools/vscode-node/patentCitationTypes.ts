/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PatentDocumentReference } from '../../patentai/common/patentDocumentReference';

/**
 * One enriched USPTO citation record, as returned by the backend citation-search routes. Shared by
 * the backward-citation tool ({@link SearchCitationsTool}) and the forward-citation tool
 * ({@link SearchForwardCitationsTool}), which consume the identical document shape from different
 * routes (`citations by application` vs `patents citing a document`).
 */
export interface CitationDoc {
	documentReference?: PatentDocumentReference | null;
	id?: string;
	applicationNumber?: string;
	citedDocument?: string;
	country?: string;
	category?: string;
	categoryDescription?: string;
	rejectedClaims?: string;
	citedPassages?: string[];
	examinerCited?: boolean;
	applicantCited?: boolean;
	isNPL?: boolean;
	officeActionDate?: string;
	officeActionType?: string;
	inventor?: string;
	techCenter?: string;
}
