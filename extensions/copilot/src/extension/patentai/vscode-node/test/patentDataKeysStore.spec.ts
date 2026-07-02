/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';
import type { ILogService } from '../../../../platform/log/common/logService';
import { getPatentDataKeys, registerPatentDataKeysProvider } from '../../common/patentDataKeysRegistry';
import { PatentDataKeysStore } from '../patentDataKeysStore';

function makeLogService(): ILogService {
	return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogService;
}

/** In-memory SecretStorage double exposing its backing map for assertions. */
function makeContext(initialSecrets: Record<string, string> = {}) {
	const secrets = new Map(Object.entries(initialSecrets));
	const context = {
		secrets: {
			get: async (key: string) => secrets.get(key),
			store: async (key: string, value: string) => { secrets.set(key, value); },
			delete: async (key: string) => { secrets.delete(key); },
		},
	} as unknown as IVSCodeExtensionContext;
	return { context, secrets };
}

beforeEach(() => registerPatentDataKeysProvider(() => undefined));

describe('PatentDataKeysStore', () => {

	it('loads persisted keys on construction and serves them through the registry seam', async () => {
		const { context } = makeContext({
			'patent-ai-data-keys': JSON.stringify({ epo: { key: 'ek', secret: 'es' }, usptoOdp: 'uk' }),
		});

		const store = PatentDataKeysStore.register(context, makeLogService());
		await store.whenReady;

		expect(getPatentDataKeys()).toEqual({ epo: { key: 'ek', secret: 'es' }, usptoOdp: 'uk' });
	});

	it('persists per-provider set/clear round-trips to SecretStorage only (partial configs are valid)', async () => {
		const { context, secrets } = makeContext();
		const store = PatentDataKeysStore.register(context, makeLogService());
		await store.whenReady;

		await store.setEpoCredentials({ key: 'ek', secret: 'es' });
		await store.setUsptoOdpKey('uk');
		await store.clearProvider('epo');

		expect(store.getKeys()).toEqual({ usptoOdp: 'uk' });
		expect(JSON.parse(secrets.get('patent-ai-data-keys')!)).toEqual({ usptoOdp: 'uk' });

		await store.clearProvider('uspto');
		expect(store.getKeys()).toBeUndefined();
		expect(secrets.has('patent-ai-data-keys')).toBe(false);
	});

	it('drops a malformed half EPO pair on load instead of forwarding it', async () => {
		const { context } = makeContext({
			'patent-ai-data-keys': JSON.stringify({ epo: { key: 'ek' }, usptoOdp: 'uk' }),
		});

		const store = PatentDataKeysStore.register(context, makeLogService());
		await store.whenReady;

		expect(store.getKeys()).toEqual({ usptoOdp: 'uk' });
	});

	it('never logs key material (presence booleans only)', async () => {
		const log = makeLogService();
		const { context } = makeContext({
			'patent-ai-data-keys': JSON.stringify({ epo: { key: 'sec-ret-key', secret: 'sec-ret-secret' } }),
		});

		const store = PatentDataKeysStore.register(context, log);
		await store.whenReady;
		await store.setUsptoOdpKey('sec-ret-uspto');

		const logged = (log.info as ReturnType<typeof vi.fn>).mock.calls.flat().join(' ');
		expect(logged).not.toContain('sec-ret');
	});
});
