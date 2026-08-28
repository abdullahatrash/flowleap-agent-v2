/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { callFacadeTool } from '../../tools/vscode-node/patentFacade';
import { OcrBridgeErrorCode, OcrBridgeImage, OcrBridgeOutcome, OcrBridgeRequest } from '../common/ocrBridge';
import { IPatentBackendClient, PatentBackendError } from './patentBackendClient';

/** OCR of a whole document is slow — Mistral reads every page — so it gets a long budget. */
const OCR_TIMEOUT_MS = 180_000;

/** `data` payload of the `ocr` facade tool. */
interface OcrToolData {
	readonly markdown?: string;
	readonly images?: readonly OcrBridgeImage[];
	readonly pageCount?: number;
}

/**
 * Run Document OCR through the shared {@link IPatentBackendClient} seam, using the backend's `ocr`
 * tool, and report the outcome without throwing.
 *
 * Going through the seam is the point: the request inherits the Bearer token, the BYO patent-data key
 * headers, the client-version header, the retry-with-backoff budget, and the centralized
 * `401`/`402`/`400`/`429` gating with its recovery notifications. The caller — the PDF viewer, in
 * another extension — gets a code it can branch on instead of a status number it has to interpret.
 */
export async function runOcrThroughSeam(
	client: IPatentBackendClient,
	request: OcrBridgeRequest,
	token: CancellationToken,
): Promise<OcrBridgeOutcome> {
	try {
		const data = await callFacadeTool<OcrToolData>(
			client,
			'ocr',
			{ file: request.file, filename: request.filename },
			token,
			{ timeoutMs: OCR_TIMEOUT_MS },
		);
		return {
			ok: true,
			markdown: data.markdown ?? '',
			images: data.images ?? [],
			pageCount: data.pageCount ?? 0,
		};
	} catch (error) {
		if (error instanceof PatentBackendError) {
			return { ok: false, code: seamErrorCode(error), message: error.message };
		}
		return { ok: false, code: 'backend_error', message: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * The seam's own code for a typed error. The typed subclasses each carry a `code`; a plain
 * {@link PatentBackendError} carries none, and a cancelled request is recognisable only by the
 * message the seam raises for it.
 */
function seamErrorCode(error: PatentBackendError): OcrBridgeErrorCode {
	if (error.message === 'Request cancelled.') {
		return 'cancelled';
	}
	const code = (error as { code?: string }).code;
	switch (code) {
		case 'auth_required':
		case 'subscription_required':
		case 'data_keys_required':
		case 'patent_provider_key_invalid':
		case 'trial_data_budget_exhausted':
		case 'rate_limited':
		case 'transient':
			return code;
		default:
			return 'backend_error';
	}
}
