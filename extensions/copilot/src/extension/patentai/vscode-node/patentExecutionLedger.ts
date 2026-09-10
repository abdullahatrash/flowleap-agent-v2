/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import type * as vscode from 'vscode';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { createServiceIdentifier } from '../../../util/common/services';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { URI } from '../../../util/vs/base/common/uri';
import { parsePatentDocumentReference, PatentDocumentReference } from '../common/patentDocumentReference';

export interface PatentEvidenceSource {
	readonly anchor: string;
	/** Exact returned text for local recovery and quotation identity checks; absent in older records. */
	readonly text?: string;
	readonly reference: PatentDocumentReference;
	readonly language?: string;
	readonly retrieval: 'returned' | 'unsegmented';
	readonly review: 'unknown';
	readonly completeness: 'unknown';
}

export interface PatentExecution {
	readonly id: string;
	readonly recordedAt: string;
	readonly kind: 'search' | 'details';
	readonly status: 'succeeded' | 'failed' | 'cancelled';
	readonly query?: string;
	readonly requestedRange?: string;
	readonly requestedCountries?: string;
	readonly effectiveQuery?: string;
	readonly countryFilter?: readonly string[];
	readonly total?: number;
	readonly returned?: number;
	readonly totalClaims?: number;
	readonly returnedClaims?: number;
	readonly range?: { begin: number; end: number };
	readonly publicationTitle?: string;
	readonly publicationDate?: string;
	readonly publicationIds?: readonly string[];
	readonly sources?: readonly PatentEvidenceSource[];
	readonly unavailableSections?: readonly string[];
}

export interface PatentExecutionSnapshot {
	readonly executions: readonly PatentExecution[];
	readonly limitation: string;
}

export const IPatentExecutionLedger = createServiceIdentifier<IPatentExecutionLedger>('IPatentExecutionLedger');
export interface IPatentExecutionLedger {
	readonly _serviceBrand: undefined;
	record(session: vscode.Uri | undefined, execution: Omit<PatentExecution, 'id' | 'recordedAt'>): Promise<string>;
	read(session: vscode.Uri | undefined): Promise<PatentExecutionSnapshot>;
}

const LIMITATION = 'Audit covers recorded search_patents and get_patent_details outcomes in this session only. Earlier versions, other tools, uninvoked or skipped plans, and interrupted calls may be absent. Retrieval is not evidence that passages were read; review status is unknown. Missing totals and source metadata remain unknown.';

/** Durable, append-only outcome records owned by the patent workflow. Separate files avoid lost concurrent writes. */
export class PatentExecutionLedger implements IPatentExecutionLedger {
	declare readonly _serviceBrand: undefined;
	constructor(
		@IVSCodeExtensionContext private readonly context: vscode.ExtensionContext,
		@IFileSystemService private readonly fileSystem: IFileSystemService,
	) { }

	private directory(session: vscode.Uri | undefined): URI | undefined {
		if (!session || !this.context.storageUri) {
			return undefined;
		}
		const key = createHash('sha256').update(session.toString()).digest('hex');
		return URI.joinPath(this.context.storageUri, 'patent-execution-ledger', key);
	}

	async record(session: vscode.Uri | undefined, execution: Omit<PatentExecution, 'id' | 'recordedAt'>): Promise<string> {
		const directory = this.directory(session);
		if (!directory) {
			return 'Execution audit unavailable: no session or workspace storage.';
		}
		const id = generateUuid();
		try {
			await this.fileSystem.createDirectory(directory);
			const temporary = URI.joinPath(directory, id + '.pending');
			await this.fileSystem.writeFile(temporary, new TextEncoder().encode(JSON.stringify({ ...execution, id, recordedAt: new Date().toISOString() })));
			await this.fileSystem.rename(temporary, URI.joinPath(directory, id + '.json'));
			return `Execution audit recorded: ${id}. Retrieval does not establish passage review.`;
		} catch {
			return 'Execution audit could not be persisted. This outcome is not included in the generated audit; disclose the gap.';
		}
	}

	async read(session: vscode.Uri | undefined): Promise<PatentExecutionSnapshot> {
		const directory = this.directory(session);
		if (!directory) {
			return { executions: [], limitation: 'Execution audit unavailable: no session or workspace storage. ' + LIMITATION };
		}
		try {
			const files = await this.fileSystem.readDirectory(directory);
			const executions: PatentExecution[] = [];
			let incomplete = false;
			for (const [name] of files) {
				if (!name.endsWith('.json')) { incomplete = true; continue; }
				try {
					const value: unknown = JSON.parse(new TextDecoder().decode(await this.fileSystem.readFile(URI.joinPath(directory, name))));
					if (!isPatentExecution(value)) { throw new Error('Invalid record'); }
					executions.push(value);
				} catch { incomplete = true; }
			}
			executions.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
			return { executions, limitation: (incomplete ? 'Some audit records are unreadable or incomplete. ' : '') + LIMITATION };
		} catch {
			return { executions: [], limitation: 'No readable execution audit is available. ' + LIMITATION };
		}
	}
}

/** Stable section/claim identity; never infer a claim or paragraph number from prose. */
export function evidenceAnchor(reference: PatentDocumentReference, language?: string): string {
	return [reference.publicationNumber, reference.section, reference.claimNumber, language].filter(Boolean).join(':');
}

/** Storage is untrusted across upgrades or interrupted writes. Reject malformed records, retaining other outcomes. */
function isPatentExecution(value: unknown): value is PatentExecution {
	if (!value || typeof value !== 'object') { return false; }
	const record = value as Record<string, unknown>;
	const strings = ['query', 'requestedRange', 'requestedCountries', 'effectiveQuery', 'publicationTitle', 'publicationDate'];
	const arrays = ['countryFilter', 'publicationIds', 'unavailableSections'];
	if (typeof record.id !== 'string' || typeof record.recordedAt !== 'string' || typeof record.kind !== 'string' || !['search', 'details'].includes(record.kind) || typeof record.status !== 'string' || !['succeeded', 'failed', 'cancelled'].includes(record.status)) { return false; }
	if (strings.some(key => record[key] !== undefined && typeof record[key] !== 'string')) { return false; }
	if (arrays.some(key => record[key] !== undefined && (!Array.isArray(record[key]) || !record[key].every(item => typeof item === 'string')))) { return false; }
	if (['total', 'returned', 'totalClaims', 'returnedClaims'].some(key => record[key] !== undefined && (typeof record[key] !== 'number' || !Number.isFinite(record[key]) || record[key] < 0))) { return false; }
	if (record.range !== undefined) {
		if (!record.range || typeof record.range !== 'object' || !('begin' in record.range) || !('end' in record.range) || typeof record.range.begin !== 'number' || typeof record.range.end !== 'number' || !Number.isFinite(record.range.begin) || !Number.isFinite(record.range.end)) { return false; }
	}
	if (record.sources !== undefined && (!Array.isArray(record.sources) || !record.sources.every(source => {
		if (!source || typeof source !== 'object') { return false; }
		const reference = parsePatentDocumentReference(source.reference);
		return reference && (source.text === undefined || typeof source.text === 'string') && (source.language === undefined || typeof source.language === 'string') && source.anchor === evidenceAnchor(reference, source.language) && ['returned', 'unsegmented'].includes(source.retrieval) && source.review === 'unknown' && source.completeness === 'unknown';
	}))) { return false; }
	return true;
}
