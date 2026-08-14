/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The command seam the PDF viewer runs Document OCR through.
//
// The PDF viewer lives in `pdf-preview`, which cannot import this extension, so it used to reach the
// backend with a bare `fetch` of its own: no retries, no BYO-key headers, no client-version header,
// no typed errors — a second, weaker client for the one call that uploads the user's own document.
// The consent gate already crosses that boundary as a command (see `ocrConsent.ts`); the extraction
// itself now crosses the same way, so every backend call in the product goes through one seam.
//
// The command answers with an OUTCOME rather than throwing: a rejection thrown across
// `executeCommand` arrives as a bare message, and the caller needs the CODE to tell "sign in" from
// "start your trial" from "wait and retry". Codes are the seam's own error codes, so this file adds
// no vocabulary of its own.

/** Where the command lives. Hand-mirrored in `pdf-preview`, which cannot import this module. */
export const OCR_RUN_COMMAND_ID = 'flowleap.ocr.run';

/** What the viewer sends: the document as base64, plus the filename the type is inferred from. */
export interface OcrBridgeRequest {
	/** Base64-encoded file content, with no `data:` prefix. */
	readonly file: string;
	/** File name including its extension — the backend infers the document type from it. */
	readonly filename: string;
}

/** One image the OCR extracted, base64-encoded for the caller to write beside the markdown. */
export interface OcrBridgeImage {
	readonly id: string;
	readonly base64: string;
	readonly mimeType: string;
}

/**
 * Why an extraction did not happen. Every value except `unavailable` is a seam error code; the
 * caller branches on these, never on message text (backend ADR 0014: wording is freely editable).
 */
export type OcrBridgeErrorCode =
	| 'auth_required'
	| 'subscription_required'
	| 'data_keys_required'
	| 'patent_provider_key_invalid'
	| 'rate_limited'
	| 'transient'
	| 'cancelled'
	| 'backend_error'
	/** The command itself could not run — Patent AI is not activated, so there is no seam to use. */
	| 'unavailable';

/** What the command answers with. Never a thrown rejection: the code has to survive the boundary. */
export type OcrBridgeOutcome =
	| {
		readonly ok: true;
		readonly markdown: string;
		readonly images: readonly OcrBridgeImage[];
		readonly pageCount: number;
	}
	| {
		readonly ok: false;
		readonly code: OcrBridgeErrorCode;
		readonly message: string;
	};
