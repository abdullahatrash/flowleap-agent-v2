/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { terminalExecutionRecord } from '../terminalExecutionRecord';

describe('terminal execution record', () => {
	it('keeps the command and the printed output of a terminal run, and nothing of other tools', () => {
		const output = [{ value: 'distinct 4G families 38892' }, { mimeType: 'image/png', data: new Uint8Array(3) }, { value: 'Huawei 3530 share 9.08%' }];
		expect({
			terminal: terminalExecutionRecord('run_in_terminal', { command: 'python3 count.py', explanation: 'Count families' }, output),
			failed: terminalExecutionRecord('run_in_terminal', { command: 'python3 count.py' }, undefined, true),
			blank: terminalExecutionRecord('run_in_terminal', { command: '  ' }, [{ value: 'x' }]),
			other: terminalExecutionRecord('read_file', { filePath: '/x' }, [{ value: 'text' }]),
		}).toEqual({
			terminal: { kind: 'analytics', status: 'succeeded', tool: 'run_in_terminal', request: 'python3 count.py', resultText: 'distinct 4G families 38892\nHuawei 3530 share 9.08%' },
			failed: { kind: 'analytics', status: 'failed', tool: 'run_in_terminal', request: 'python3 count.py' },
			blank: undefined,
			other: undefined,
		});
	});
});
