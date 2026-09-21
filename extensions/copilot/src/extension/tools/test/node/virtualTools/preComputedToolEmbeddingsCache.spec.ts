/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ILogService } from '../../../../../platform/log/common/logService';
import { IFetcherService } from '../../../../../platform/networking/common/fetcherService';
import { ITestingServicesAccessor } from '../../../../../platform/test/node/services';
import { IInstantiationService } from '../../../../../util/vs/platform/instantiation/common/instantiation';
import { createExtensionUnitTestingServices } from '../../../../test/node/services';
import { EMBEDDING_TYPE_FOR_TOOL_GROUPING, PreComputedToolEmbeddingsCache } from '../../../common/virtualTools/preComputedToolEmbeddingsCache';

describe('PreComputedToolEmbeddingsCache', () => {
	let accessor: ITestingServicesAccessor;

	beforeEach(() => {
		const services = createExtensionUnitTestingServices();
		accessor = services.createTestingAccessor();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		accessor.dispose();
	});

	it('never fetches the remote embeddings CDN and resolves to an empty cache', async () => {
		const fetchSpy = vi.spyOn(accessor.get(IFetcherService), 'fetch');
		const errorSpy = vi.spyOn(accessor.get(ILogService), 'error');
		const warnSpy = vi.spyOn(accessor.get(ILogService), 'warn');

		const cache = accessor.get(IInstantiationService).createInstance(PreComputedToolEmbeddingsCache);
		await cache.initialize();

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
		expect(warnSpy).not.toHaveBeenCalled();

		expect(cache.embeddingType).toBe(EMBEDDING_TYPE_FOR_TOOL_GROUPING);
		expect(cache.get({ name: 'anyTool' })).toBeUndefined();
	});
});
