/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { IPatentExecutionLedger } from '../../../patentai/vscode-node/patentExecutionLedger';
export const unrecordedPatentLedger: IPatentExecutionLedger = {
	_serviceBrand: undefined,
	record: async () => 'Audit unavailable in this test.',
	read: async () => ({ executions: [], limitation: 'No records in this test.' }),
};
