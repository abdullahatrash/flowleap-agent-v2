/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';
import { IPatentExecutionLedger, PatentExecution } from '../../../patentai/vscode-node/patentExecutionLedger';
export const unrecordedPatentLedger: IPatentExecutionLedger = {
	_serviceBrand: undefined,
	record: async () => 'Audit unavailable in this test.',
	read: async () => ({ executions: [], limitation: 'No records in this test.' }),
};

/** A ledger that keeps what a tool recorded, so a test can assert the outcome shape. */
export function recordingPatentLedger(): { ledger: IPatentExecutionLedger; executions: Omit<PatentExecution, 'id' | 'recordedAt'>[] } {
	const executions: Omit<PatentExecution, 'id' | 'recordedAt'>[] = [];
	return {
		executions,
		ledger: {
			...unrecordedPatentLedger,
			record: async (_session: vscode.Uri | undefined, execution: Omit<PatentExecution, 'id' | 'recordedAt'>) => {
				executions.push(execution);
				return 'Recorded.';
			},
		},
	};
}
