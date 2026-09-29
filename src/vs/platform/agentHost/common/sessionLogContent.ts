/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MarshalledId } from '../../../base/common/marshallingIds.js';
import { isUriComponents, URI, UriComponents } from '../../../base/common/uri.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';

/**
 * How much of an agent session a diagnostic log may hold.
 *
 * - `metadata`: the default. Only identifiers, method and type names, tool
 *   names, token counts, timings and error codes reach the log. User text,
 *   model text, tool input and output, and file content never do.
 * - `full`: the complete protocol message (upstream behavior). Developer only,
 *   enabled by {@link AgentHostAhpJsonlLoggingIncludeContentSettingId}.
 *
 * FlowLeap fork (PRD 0018 A4, ADR 0009 decision 4): session content stays on
 * the machine in the resume store only (the Claude SDK transcript and the
 * per-session database). Diagnostic logs are metadata unless a developer asks.
 */
export type SessionLogContent = 'metadata' | 'full';

/**
 * Developer setting that lets the AHP JSONL log keep full message content.
 * Defaults to `false`. Has no effect unless AHP logging itself is enabled.
 */
export const AgentHostAhpJsonlLoggingIncludeContentSettingId = 'chat.agentHost.ahpJsonlLoggingIncludeContent';

/**
 * Reads the {@link SessionLogContent} mode from configuration. Anything other
 * than an explicit `true` gives `metadata`.
 */
export function getSessionLogContent(configurationService: IConfigurationService): SessionLogContent {
	return configurationService.getValue<boolean>(AgentHostAhpJsonlLoggingIncludeContentSettingId) === true ? 'full' : 'metadata';
}

/**
 * Keys whose scalar values are metadata. Everything else is dropped, so a new
 * protocol field is private until it is added here on purpose.
 */
const METADATA_KEYS = new Set([
	'jsonrpc', 'id', 'method',
	'type', 'kind', 'subtype', 'status',
	'toolName', 'toolCallId', 'turnId', 'requestId',
	'session', 'sessionId', 'session_id', 'chat', 'channel', 'clientId', 'uuid',
	'model', 'provider', 'agent',
]);

/**
 * Keys that are metadata only as numbers. `code` is here because a tool input
 * can carry a `code` string (source code), while error codes are numbers.
 */
const METADATA_NUMBER_KEYS = new Set(['code', 'protocolVersion', 'seq', 'serverSeq', 'clientSeq']);

/** Numeric counters (token counts, durations) are metadata under any key with these suffixes. */
const METADATA_NUMBER_KEY_SUFFIX = /(Tokens|_tokens|Count|Ms|_ms)$/;

/** A metadata string longer than this is not an identifier; it is cut to bound any misuse. */
const MAX_METADATA_STRING_LENGTH = 256;

/**
 * Projects a protocol message (or any JSON-like value) to its metadata. The
 * result keeps the shape of the input for the keys that survive, so a reader
 * such as the AHP Log view still sees `id`, `method` and `error.code`.
 */
export function toSessionLogMetadata(value: object): Record<string, unknown> {
	return (projectObject(value) ?? {}) as Record<string, unknown>;
}

function projectObject(value: object): Record<string, unknown> | unknown[] | undefined {
	if (Array.isArray(value)) {
		const items = value.map(item => item && typeof item === 'object' ? projectObject(item) : undefined).filter(item => item !== undefined);
		return items.length > 0 ? items : undefined;
	}
	let result: Record<string, unknown> | undefined;
	for (const [key, child] of Object.entries(value)) {
		const projected = projectEntry(key, child);
		if (projected !== undefined) {
			result ??= {};
			result[key] = projected;
		}
	}
	return result;
}

function projectEntry(key: string, value: unknown): unknown {
	if (value === null) {
		return METADATA_KEYS.has(key) ? null : undefined;
	}
	switch (typeof value) {
		case 'string':
			return METADATA_KEYS.has(key) ? value.slice(0, MAX_METADATA_STRING_LENGTH) : undefined;
		case 'number':
		case 'boolean':
			return METADATA_KEYS.has(key) || METADATA_NUMBER_KEYS.has(key) || METADATA_NUMBER_KEY_SUFFIX.test(key) ? value : undefined;
		case 'object': {
			if (METADATA_KEYS.has(key) && isMarshalledUri(value)) {
				return URI.revive(value).toString().slice(0, MAX_METADATA_STRING_LENGTH);
			}
			return projectObject(value as object);
		}
		default:
			return undefined;
	}
}

function isMarshalledUri(value: object): value is UriComponents {
	return URI.isUri(value) || ((value as { $mid?: number }).$mid === MarshalledId.Uri && isUriComponents(value));
}
