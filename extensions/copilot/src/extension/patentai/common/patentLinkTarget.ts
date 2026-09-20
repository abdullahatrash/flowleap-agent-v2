/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PATENT_DOCUMENT_AUTHORITY, PATENT_DOCUMENT_PATH } from './patentDocumentReference';

/**
 * Which surface a recognized patent link points at. Carried into the pill tooltip so a reader can
 * see where the link went, never into the lookup itself: every source resolves to the same
 * publication number, and the number is what the backend is asked about.
 */
export type PatentLinkSource = 'reader' | 'googlePatents' | 'espacenet' | 'uspto';

export interface PatentLinkTarget {
	/** Normalized publication number, e.g. `EP1602570B1`: upper case, separators removed. */
	readonly publicationNumber: string;
	readonly source: PatentLinkSource;
}

/**
 * A publication number as it appears inside a URI: a two-letter office code (WIPO ST.3), the serial,
 * and an optional kind code. The office code is taken as given rather than checked against a list —
 * ST.3 has about a hundred codes, and an unknown one simply fails the lookup and leaves the link
 * un-enriched, which is cheaper than a list that silently omits an office.
 */
const PUBLICATION_NUMBER = /^(?<office>[A-Z]{2})(?<serial>\d{4,16})(?<kind>[A-Z]\d?)?$/;

/** Same shape as {@link PUBLICATION_NUMBER}, spelled for the manifest's URI pattern. */
const NUMBER_IN_URI = '[A-Za-z]{2}[0-9]{4,16}[A-Za-z]?[0-9]?';

/** Host suffix of both Espacenet generations. */
const ESPACENET_HOST = '(?:[a-z0-9-]+\\.)*espacenet\\.com';

/**
 * The `uriPattern` of the `linkPresentationProviders` contribution, kept here next to the recognizer
 * it must agree with (a test asserts the manifest carries this exact string, and that every URI the
 * recognizer accepts matches it).
 *
 * The core matches this against the canonical URI string BEFORE activating the extension, so it is
 * the cheap prefilter: a link that does not carry a publication-number shape never reaches the
 * provider and stays a plain link. It must be anchored (`^`…`$`) and is matched case-insensitively.
 */
export const PATENT_LINK_URI_PATTERN = '^(?:'
	// The FlowLeap patent reader's own links, as the patent tools write them into a report. The
	// scheme is the product's (`flowleap`, `flowleap-insiders`, `code-oss` in development), so any
	// scheme is accepted for this authority.
	+ `[a-z][a-z0-9+.-]*://${PATENT_DOCUMENT_AUTHORITY.replace(/\./g, '\\.')}${PATENT_DOCUMENT_PATH}\\?(?:[^#]*&)?publication=${NUMBER_IN_URI}(?:[&#].*)?`
	// Google Patents: `https://patents.google.com/patent/US10958080B2/en`.
	+ `|https?://patents\\.google\\.com/patent/${NUMBER_IN_URI}(?:/[^?#]*)?(?:[?#].*)?`
	// Espacenet, current: `…/patent/search/family/012345/publication/EP1602570B1?q=…`.
	+ `|https?://${ESPACENET_HOST}/patent/search/family/[0-9]+/publication/${NUMBER_IN_URI}(?:[?#].*)?`
	// Espacenet, classic: `…/publicationDetails/biblio?CC=EP&NR=1602570B1&KC=B1`.
	+ `|https?://${ESPACENET_HOST}/publicationDetails/[a-zA-Z]+\\?(?:[^#]*&)?CC=[A-Za-z]{2}&(?:[^#]*&)?NR=[0-9]{4,16}[A-Za-z]?[0-9]?(?:[&#].*)?`
	// USPTO Patent Public Search document PDFs: `…/dirsearch-public/print/downloadPdf/10958080`.
	+ `|https?://(?:image-)?ppubs\\.uspto\\.gov/dirsearch-public/print/downloadPdf/[0-9]{4,16}(?:[?#].*)?`
	+ ')$';

/**
 * Normalize a publication number the way the patent reader does — drop the separators offices print
 * (`EP 1 602 570 B1`, `KR10-2020-0012345`) and upper-case the rest — then require the office/serial/
 * kind shape. Returns `undefined` for anything else, including a bare serial with no office.
 */
export function parsePublicationNumber(value: string | null | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	const compact = value.replace(/[.\s,/_-]/g, '').toUpperCase();
	return PUBLICATION_NUMBER.test(compact) ? compact : undefined;
}

/**
 * Read the publication number a link points at, or `undefined` when the URI is not one of the patent
 * surfaces this provider knows. Deliberately narrow: an unrecognized link must keep rendering as a
 * plain link rather than as an empty or wrong pill.
 */
export function recognizePatentLink(value: string): PatentLinkTarget | undefined {
	let uri: URL;
	try {
		uri = new URL(value);
	} catch {
		return undefined;
	}
	const host = uri.hostname.toLowerCase();

	if (host === PATENT_DOCUMENT_AUTHORITY && uri.pathname === PATENT_DOCUMENT_PATH) {
		return target(uri.searchParams.get('publication'), 'reader');
	}
	if (host === 'patents.google.com') {
		const segments = pathSegments(uri);
		return segments?.[0] === 'patent' ? target(segments[1], 'googlePatents') : undefined;
	}
	if (host === 'espacenet.com' || host.endsWith('.espacenet.com')) {
		return espacenetTarget(uri);
	}
	if (host === 'ppubs.uspto.gov' || host === 'image-ppubs.uspto.gov') {
		const segments = pathSegments(uri);
		// Patent Public Search prints a US document by serial alone; the office is the host's.
		return segments?.length === 4 && segments[2] === 'downloadPdf'
			? target(`US${segments[3]}`, 'uspto')
			: undefined;
	}
	return undefined;
}

/** Both Espacenet generations: the current `/publication/<number>` path and the classic `CC`/`NR`/`KC` query. */
function espacenetTarget(uri: URL): PatentLinkTarget | undefined {
	const segments = pathSegments(uri);
	if (segments?.length === 6 && segments[0] === 'patent' && segments[1] === 'search' && segments[4] === 'publication') {
		return target(segments[5], 'espacenet');
	}
	if (segments?.[0] === 'publicationDetails') {
		const country = uri.searchParams.get('CC');
		const number = uri.searchParams.get('NR');
		if (!country || !number) {
			return undefined;
		}
		// Classic Espacenet splits the kind code out of `NR` for some documents and leaves it in for
		// others, so `KC` is appended only when `NR` carries no kind letter of its own — appending it
		// to `NR=1602570B1` would read as the serial `…B1B1` and resolve to nothing.
		const kind = /[A-Za-z]/.test(number) ? '' : uri.searchParams.get('KC') ?? '';
		return target(`${country}${number}${kind}`, 'espacenet');
	}
	return undefined;
}

function pathSegments(uri: URL): string[] | undefined {
	try {
		return uri.pathname.split('/').filter(Boolean).map(decodeURIComponent);
	} catch {
		return undefined;
	}
}

function target(value: string | null | undefined, source: PatentLinkSource): PatentLinkTarget | undefined {
	const publicationNumber = parsePublicationNumber(value);
	return publicationNumber ? { publicationNumber, source } : undefined;
}
