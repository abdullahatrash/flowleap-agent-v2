/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { bufferToStream, VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IRequestContext, IRequestOptions } from '../../../../base/parts/request/common/request.js';
import { FileService } from '../../../files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../log/common/log.js';
import product from '../../../product/common/product.js';
import { IProductService } from '../../../product/common/productService.js';
import { AbstractRequestService, AuthInfo, Credentials } from '../../../request/common/request.js';
import { getMcpGalleryManifestResourceUri, McpGalleryResourceType } from '../../common/mcpGalleryManifest.js';
import { McpGalleryManifestService } from '../../common/mcpGalleryManifestService.js';
import { McpGalleryService } from '../../common/mcpGalleryService.js';

class TestRequestService extends AbstractRequestService {

	readonly requests: IRequestOptions[] = [];

	constructor(private readonly handler: (options: IRequestOptions) => IRequestContext) {
		super(new NullLogService());
	}

	async request(options: IRequestOptions): Promise<IRequestContext> {
		this.requests.push(options);
		return this.handler(options);
	}

	async resolveProxy(): Promise<string | undefined> { return undefined; }
	async lookupAuthorization(_authInfo: AuthInfo): Promise<Credentials | undefined> { return undefined; }
	async lookupKerberosAuthorization(): Promise<string | undefined> { return undefined; }
	async loadCertificates(): Promise<string[]> { return []; }
}

function response(statusCode: number, body: string = ''): IRequestContext {
	return {
		res: { headers: {}, statusCode },
		stream: bufferToStream(VSBuffer.fromString(body))
	};
}

function productWithMcpGallery(mcpGallery: IProductService['mcpGallery']): IProductService {
	return { _serviceBrand: undefined, ...product, mcpGallery };
}

// The item web URL template is what product.json ships; the gallery substitutes the raw
// server name (slashes preserved) into `{name}` to build each entry's marketplace link.
const ITEM_WEB_URL = 'https://www.flowleap.co/en/marketplace/mcp/{name}';

// A fixture in the gallery's internal result shape. The `file:` source path reads this
// directly (it bypasses the HTTP serializer), mirroring the data our live v0 registry
// returns for these servers so we assert against the shape the installer consumes.
const FIXTURE_REGISTRY = JSON.stringify({
	metadata: { count: 2 },
	servers: [
		{
			name: 'co.flowleap/flowleap',
			description: 'FlowLeap Patent AI over MCP.',
			version: '0.3.0',
			status: 'active',
			packages: [{
				registryType: 'npm',
				identifier: 'flowleap',
				version: '0.3.0',
				runtimeHint: 'npx',
				transport: { type: 'stdio' },
				environmentVariables: [
					{ name: 'FLOWLEAP_API_KEY', description: 'FlowLeap personal API token.', isRequired: false, isSecret: true },
					{ name: 'FLOWLEAP_EPO_KEY', description: 'EPO OPS consumer key.', isRequired: false, isSecret: true },
					{ name: 'FLOWLEAP_EPO_SECRET', description: 'EPO OPS consumer secret.', isRequired: false, isSecret: true },
					{ name: 'FLOWLEAP_USPTO_KEY', description: 'USPTO ODP API key.', isRequired: false, isSecret: true }
				]
			}]
		},
		{
			name: 'io.modelcontextprotocol/filesystem',
			description: 'Secure local file access.',
			version: '1.0.0',
			status: 'active',
			packages: [{
				registryType: 'npm',
				identifier: '@modelcontextprotocol/server-filesystem',
				version: '1.0.0',
				runtimeHint: 'npx',
				transport: { type: 'stdio' }
			}]
		}
	]
});

suite('McpGalleryService', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('enumerates entries and install metadata from a file: registry, linking each to its marketplace page', async () => {
		const fileService = store.add(new FileService(new NullLogService()));
		store.add(fileService.registerProvider(Schemas.file, store.add(new InMemoryFileSystemProvider())));

		// The gallery appends `/{version}/servers` to the service URL. With no reachable
		// version endpoint the manifest falls back to the newest supported version, so the
		// fixture lives at that path under the configured base.
		await fileService.createFolder(URI.parse('file:///registry/v0.1'));
		await fileService.writeFile(URI.parse('file:///registry/v0.1/servers'), VSBuffer.fromString(FIXTURE_REGISTRY));

		const productService = productWithMcpGallery({
			serviceUrl: 'file:///registry',
			itemWebUrl: ITEM_WEB_URL,
			publisherUrl: 'https://www.flowleap.co/en/marketplace',
			supportUrl: 'https://www.flowleap.co/en/contact',
			privacyPolicyUrl: 'https://www.flowleap.co/en/privacy',
			termsOfServiceUrl: 'https://www.flowleap.co/en/terms',
			reportUrl: 'https://www.flowleap.co/en/contact'
		});
		const requestService = store.add(new TestRequestService(() => response(404)));
		const manifestService = store.add(new McpGalleryManifestService(productService, requestService, new NullLogService()));
		const galleryService = store.add(new McpGalleryService(requestService, fileService, new NullLogService(), manifestService));

		const { firstPage } = await galleryService.query(undefined, CancellationToken.None);

		const actual = firstPage.items.map(server => ({
			name: server.name,
			displayName: server.displayName,
			publisher: server.publisher,
			version: server.version,
			webUrl: server.webUrl,
			packageId: server.configuration.packages?.[0].identifier,
			registryType: server.configuration.packages?.[0].registryType,
			environmentVariables: (server.configuration.packages?.[0].environmentVariables ?? []).map(v => v.name)
		}));

		assert.deepStrictEqual(actual, [
			{
				name: 'co.flowleap/flowleap',
				displayName: 'Flowleap',
				publisher: 'flowleap',
				version: '0.3.0',
				webUrl: 'https://www.flowleap.co/en/marketplace/mcp/co.flowleap/flowleap',
				packageId: 'flowleap',
				registryType: 'npm',
				environmentVariables: ['FLOWLEAP_API_KEY', 'FLOWLEAP_EPO_KEY', 'FLOWLEAP_EPO_SECRET', 'FLOWLEAP_USPTO_KEY']
			},
			{
				name: 'io.modelcontextprotocol/filesystem',
				displayName: 'Filesystem',
				publisher: 'modelcontextprotocol',
				version: '1.0.0',
				webUrl: 'https://www.flowleap.co/en/marketplace/mcp/io.modelcontextprotocol/filesystem',
				packageId: '@modelcontextprotocol/server-filesystem',
				registryType: 'npm',
				environmentVariables: []
			}
		]);
	});

	// Our live marketplace answers `https://www.flowleap.co/api/mcp/v0.1/...`, so this is the
	// exact document shape `getMcpServer` has to accept after the gallery source validation.
	const FIXTURE_SERVER_DOCUMENT = JSON.stringify({
		server: {
			name: 'co.flowleap/flowleap',
			description: 'FlowLeap Patent AI over MCP.',
			version: '0.3.8',
			websiteUrl: 'https://www.flowleap.co',
			repository: { url: 'https://github.com/flowleap-ai/flowleap-cli', source: 'github' },
			packages: [{
				identifier: 'flowleap',
				registryType: 'npm',
				version: '0.3.8',
				transport: { type: 'stdio' },
				runtimeHint: 'npx',
				packageArguments: [{ description: 'Runs the FlowLeap CLI as a stdio MCP server.', value: 'mcp', type: 'positional', valueHint: 'subcommand' }],
				environmentVariables: [{ name: 'FLOWLEAP_API_KEY', description: 'FlowLeap personal API token.', isRequired: false, isSecret: true }]
			}]
		},
		_meta: {
			'io.modelcontextprotocol.registry/official': {
				status: 'active',
				isLatest: true,
				publishedAt: '2026-07-11T00:00:00.000Z',
				updatedAt: '2026-07-23T16:06:48.000Z'
			}
		}
	});

	function galleryFixture(handler: (options: IRequestOptions) => IRequestContext) {
		const fileService = store.add(new FileService(new NullLogService()));
		store.add(fileService.registerProvider(Schemas.file, store.add(new InMemoryFileSystemProvider())));
		const productService = productWithMcpGallery({
			serviceUrl: 'https://registry.test/api/mcp',
			itemWebUrl: ITEM_WEB_URL,
			publisherUrl: 'https://www.flowleap.co/en/marketplace',
			supportUrl: 'https://www.flowleap.co/en/contact',
			privacyPolicyUrl: 'https://www.flowleap.co/en/privacy',
			termsOfServiceUrl: 'https://www.flowleap.co/en/terms',
			reportUrl: 'https://www.flowleap.co/en/contact'
		});
		const requestService = store.add(new TestRequestService(handler));
		const manifestService = store.add(new McpGalleryManifestService(productService, requestService, new NullLogService()));
		const galleryService = store.add(new McpGalleryService(requestService, fileService, new NullLogService(), manifestService));
		return { galleryService, manifestService, requestService };
	}

	test('resolves an install from our marketplace shape through the validated gallery URL', async () => {
		const { galleryService, requestService } = galleryFixture(options => {
			if (options.url === 'https://registry.test/api/mcp/v0.1/servers?limit=1') {
				return response(200, JSON.stringify({ metadata: { count: 0 }, servers: [] }));
			}
			if (options.url === 'https://registry.test/api/mcp/v0.1/servers/co.flowleap%2Fflowleap/versions/latest') {
				return response(200, FIXTURE_SERVER_DOCUMENT);
			}
			return response(404);
		});

		const servers = await galleryService.getMcpServersFromGallery([{ name: 'co.flowleap/flowleap' }]);

		assert.deepStrictEqual(servers.map(server => ({
			name: server.name,
			version: server.version,
			registryType: server.configuration.packages?.[0].registryType,
			packageId: server.configuration.packages?.[0].identifier,
			environmentVariables: (server.configuration.packages?.[0].environmentVariables ?? []).map(v => v.name),
			followedRedirects: requestService.requests.some(r => r.url?.includes('/versions/latest') && r.followRedirects !== 0)
		})), [{
			name: 'co.flowleap/flowleap',
			version: '0.3.8',
			registryType: 'npm',
			packageId: 'flowleap',
			environmentVariables: ['FLOWLEAP_API_KEY'],
			followedRedirects: false
		}]);
	});

	test('refuses a server document outside the configured gallery without issuing a request', async () => {
		const { galleryService, manifestService, requestService } = galleryFixture(options =>
			response(options.url === 'https://registry.test/api/mcp/v0.1/servers?limit=1' ? 200 : 404));
		const manifest = await manifestService.getMcpGalleryManifest();
		const requestsAfterManifest = requestService.requests.length;

		await assert.rejects(() => galleryService.getMcpServer('https://evil.test/api/mcp/v0.1/servers/co.flowleap%2Fflowleap', manifest));
		assert.strictEqual(requestService.requests.length, requestsAfterManifest);
	});

	test('treats a redirected server document as a failure, not a missing server', async () => {
		const { galleryService, manifestService } = galleryFixture(options =>
			response(options.url === 'https://registry.test/api/mcp/v0.1/servers?limit=1' ? 200 : 302));
		const manifest = await manifestService.getMcpGalleryManifest();

		await assert.rejects(() => galleryService.getMcpServer('https://registry.test/api/mcp/v0.1/servers/co.flowleap%2Fflowleap/versions/latest', manifest));
	});

	test('negotiates the API version the endpoint serves (v0), not the newest one it does not', async () => {
		// Guards the fix for the FlowLeap registry: it serves the standard v0 API and its
		// v0.1 path is unavailable, so the product gallery must probe and settle on v0
		// instead of pinning the newest supported version.
		const fileService = store.add(new FileService(new NullLogService()));
		store.add(fileService.registerProvider(Schemas.file, store.add(new InMemoryFileSystemProvider())));

		const productService = productWithMcpGallery({
			serviceUrl: 'https://registry.test/api/mcp',
			itemWebUrl: ITEM_WEB_URL,
			publisherUrl: 'https://www.flowleap.co/en/marketplace',
			supportUrl: 'https://www.flowleap.co/en/contact',
			privacyPolicyUrl: 'https://www.flowleap.co/en/privacy',
			termsOfServiceUrl: 'https://www.flowleap.co/en/terms',
			reportUrl: 'https://www.flowleap.co/en/contact'
		});
		const requestService = store.add(new TestRequestService(options => response(options.url!.includes('/v0/servers') ? 200 : 404)));
		const manifestService = store.add(new McpGalleryManifestService(productService, requestService, new NullLogService()));

		const manifest = await manifestService.getMcpGalleryManifest();

		assert.strictEqual(manifest?.version, 'v0');
		assert.strictEqual(
			getMcpGalleryManifestResourceUri(manifest!, McpGalleryResourceType.McpServersQueryService),
			'https://registry.test/api/mcp/v0/servers'
		);
	});
});
