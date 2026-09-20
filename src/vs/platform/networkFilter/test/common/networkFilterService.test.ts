/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ConfigurationTarget } from '../../../configuration/common/configuration.js';
import { TestConfigurationService } from '../../../configuration/test/common/testConfigurationService.js';
import { AgentNetworkFilterService } from '../../common/networkFilterService.js';
import { AgentNetworkDomainSettingId } from '../../common/settings.js';

suite('AgentNetworkFilterService', () => {

	let disposables: DisposableStore;
	let configService: TestConfigurationService;

	setup(() => {
		disposables = new DisposableStore();
		configService = new TestConfigurationService();
		configService.setUserConfiguration(AgentNetworkDomainSettingId.NetworkFilter, true);
		configService.setUserConfiguration(AgentNetworkDomainSettingId.AllowedNetworkDomains, []);
		configService.setUserConfiguration(AgentNetworkDomainSettingId.DeniedNetworkDomains, []);
	});

	teardown(() => {
		disposables.dispose();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	async function createService(): Promise<AgentNetworkFilterService> {
		const service = new AgentNetworkFilterService(configService);
		disposables.add(service);
		return service;
	}

	function fireConfigChange(key: string): void {
		configService.onDidChangeConfigurationEmitter.fire({
			source: ConfigurationTarget.USER,
			affectedKeys: new Set([key]),
			change: { keys: [key], overrides: [] },
			affectsConfiguration: (k: string) => k === key,
		});
	}

	test('allows all domains when filter is disabled, regardless of configured lists', async () => {
		configService.setUserConfiguration(AgentNetworkDomainSettingId.NetworkFilter, false);
		configService.setUserConfiguration(AgentNetworkDomainSettingId.AllowedNetworkDomains, ['example.com']);
		configService.setUserConfiguration(AgentNetworkDomainSettingId.DeniedNetworkDomains, ['blocked.com']);

		const service = await createService();

		assert.strictEqual(service.isUriAllowed(URI.parse('https://example.com')), true);
		assert.strictEqual(service.isUriAllowed(URI.parse('https://anything.test')), true);
		assert.strictEqual(service.isUriAllowed(URI.parse('https://blocked.com')), true);
	});

	test('denies all domains when both lists are empty', async () => {
		const service = await createService();
		assert.strictEqual(service.isUriAllowed(URI.parse('https://example.com')), false);
		assert.strictEqual(service.isUriAllowed(URI.parse('https://anything.test')), false);
	});

	test('blocks denied domains', async () => {
		configService.setUserConfiguration(AgentNetworkDomainSettingId.DeniedNetworkDomains, ['evil.com']);
		const service = await createService();
		assert.strictEqual(service.isUriAllowed(URI.parse('https://evil.com')), false);
		assert.strictEqual(service.isUriAllowed(URI.parse('https://good.com')), true);
	});

	test('restricts to allowed domains', async () => {
		configService.setUserConfiguration(AgentNetworkDomainSettingId.AllowedNetworkDomains, ['example.com']);
		const service = await createService();
		assert.strictEqual(service.isUriAllowed(URI.parse('https://example.com')), true);
		assert.strictEqual(service.isUriAllowed(URI.parse('https://other.com')), false);
	});

	test('denied takes precedence over allowed', async () => {
		configService.setUserConfiguration(AgentNetworkDomainSettingId.AllowedNetworkDomains, ['*.com']);
		configService.setUserConfiguration(AgentNetworkDomainSettingId.DeniedNetworkDomains, ['evil.com']);
		const service = await createService();
		assert.strictEqual(service.isUriAllowed(URI.parse('https://safe.com')), true);
		assert.strictEqual(service.isUriAllowed(URI.parse('https://evil.com')), false);
	});

	suite('isUriAllowed', () => {

		test('allows file URIs', async () => {
			const service = await createService();
			configService.setUserConfiguration(AgentNetworkDomainSettingId.DeniedNetworkDomains, ['*']);
			assert.strictEqual(service.isUriAllowed(URI.file('/tmp/test.txt')), true);
		});

		test('allows URIs without authority', async () => {
			const service = await createService();
			configService.setUserConfiguration(AgentNetworkDomainSettingId.DeniedNetworkDomains, ['*']);
			assert.strictEqual(service.isUriAllowed(URI.from({ scheme: 'untitled', path: 'Untitled-1' })), true);
		});

		test('fails closed for reported HTTP(S) parser-differential URLs with empty authorities', async () => {
			configService.setUserConfiguration(AgentNetworkDomainSettingId.AllowedNetworkDomains, ['*']);
			const service = await createService();
			const urls = [
				String.raw`http:\\\\evil.example/x`,
				String.raw`http:/\\/\\evil.example/x`,
				String.raw`http:\\/evil.example/x`,
				String.raw`http:\\evil.example/x`,
				String.raw`https:\\evil.example/x`,
			];

			assert.deepStrictEqual(urls.map(url => {
				const uri = URI.parse(url);
				return {
					scheme: uri.scheme,
					authority: uri.authority,
					allowed: service.isUriAllowed(uri),
				};
			}), [
				{ scheme: 'http', authority: '', allowed: false },
				{ scheme: 'http', authority: '', allowed: false },
				{ scheme: 'http', authority: '', allowed: false },
				{ scheme: 'http', authority: '', allowed: false },
				{ scheme: 'https', authority: '', allowed: false },
			]);
		});

		test('fails closed for WebSocket parser-differential URLs with empty authorities', async () => {
			configService.setUserConfiguration(AgentNetworkDomainSettingId.AllowedNetworkDomains, ['*']);
			const service = await createService();
			const urls = [
				String.raw`ws:\\evil.example/socket`,
				String.raw`wss:\evil.example/socket`,
			];

			assert.deepStrictEqual(urls.map(url => {
				const uri = URI.parse(url);
				return {
					scheme: uri.scheme,
					authority: uri.authority,
					allowed: service.isUriAllowed(uri),
				};
			}), [
				{ scheme: 'ws', authority: '', allowed: false },
				{ scheme: 'wss', authority: '', allowed: false },
			]);
		});

		test('checks domain for http/https URIs', async () => {
			configService.setUserConfiguration(AgentNetworkDomainSettingId.AllowedNetworkDomains, ['example.com']);
			const service = await createService();
			assert.strictEqual(service.isUriAllowed(URI.parse('https://example.com/page')), true);
			assert.strictEqual(service.isUriAllowed(URI.parse('https://other.com/page')), false);
		});

		test('denies IPv6 literals when both domain lists are empty', async () => {
			const service = await createService();
			assert.deepStrictEqual([
				service.isUriAllowed(URI.parse('http://[::1]:3000/private')),
				service.isUriAllowed(URI.parse('http://[0:0:0:0:0:0:0:1]/private')),
				service.isUriAllowed(URI.parse('http://[::ffff:127.0.0.1]/private')),
				service.isUriAllowed(URI.parse('http://[::ffff:7f00:1]/private')),
				service.isUriAllowed(URI.parse('https://[2001:db8::1]/private')),
				service.isUriAllowed(URI.parse('https://[fe80::1]/private')),
			], [
				false,
				false,
				false,
				false,
				false,
				false,
			]);
		});

		test('does not allow IPv6 literals through a DNS-only allowlist', async () => {
			configService.setUserConfiguration(AgentNetworkDomainSettingId.AllowedNetworkDomains, ['github.com']);
			const service = await createService();
			assert.deepStrictEqual([
				service.isUriAllowed(URI.parse('https://github.com')),
				service.isUriAllowed(URI.parse('https://[2001:db8::1]')),
				service.isUriAllowed(URI.parse('http://[::ffff:127.0.0.1]')),
			], [
				true,
				false,
				false,
			]);
		});

		test('blocks IPv4-mapped IPv6 literals in a deny-only configuration', async () => {
			configService.setUserConfiguration(AgentNetworkDomainSettingId.DeniedNetworkDomains, [
				'127.0.0.1',
				'169.254.169.254',
			]);
			const service = await createService();
			assert.deepStrictEqual([
				service.isUriAllowed(URI.parse('http://[::ffff:127.0.0.1]/private')),
				service.isUriAllowed(URI.parse('http://[::ffff:7f00:1]/private')),
				service.isUriAllowed(URI.parse('http://[::ffff:169.254.169.254]/private')),
				service.isUriAllowed(URI.parse('http://[::ffff:a9fe:a9fe]/private')),
			], [
				false,
				false,
				false,
				false,
			]);
		});

		test('matches explicit IPv6 allow and deny patterns', async () => {
			configService.setUserConfiguration(AgentNetworkDomainSettingId.AllowedNetworkDomains, ['[::1]', '[2001:db8::1]']);
			configService.setUserConfiguration(AgentNetworkDomainSettingId.DeniedNetworkDomains, ['[0:0:0:0:0:0:0:1]']);
			const service = await createService();
			assert.deepStrictEqual([
				service.isUriAllowed(URI.parse('http://[::1]')),
				service.isUriAllowed(URI.parse('https://[2001:0db8:0:0:0:0:0:1]')),
				service.isUriAllowed(URI.parse('http://[::ffff:127.0.0.1]')),
			], [
				false,
				true,
				false,
			]);
		});

		test('fails closed for malformed non-empty HTTP authorities', async () => {
			configService.setUserConfiguration(AgentNetworkDomainSettingId.AllowedNetworkDomains, ['*']);
			const service = await createService();
			assert.deepStrictEqual([
				service.isUriAllowed(URI.from({ scheme: 'http', authority: '[::1', path: '/' })),
				service.isUriAllowed(URI.from({ scheme: 'https', authority: '::1]', path: '/' })),
				service.isUriAllowed(URI.from({ scheme: 'http', authority: '[::1]extra', path: '/' })),
				service.isUriAllowed(URI.from({ scheme: 'http', authority: '[fe80::1%25eth0]', path: '/' })),
				service.isUriAllowed(URI.from({ scheme: 'HTTP', authority: '[::1', path: '/' })),
				service.isUriAllowed(URI.parse('Https://allowed.com%2F@evil.com/private')),
			], [
				false,
				false,
				false,
				false,
				false,
				false,
			]);
		});
	});

	test('fires onDidChange when configuration changes', async () => {
		const service = await createService();
		let fired = false;
		disposables.add(service.onDidChange(() => { fired = true; }));

		configService.setUserConfiguration(AgentNetworkDomainSettingId.AllowedNetworkDomains, ['example.com']);
		fireConfigChange(AgentNetworkDomainSettingId.AllowedNetworkDomains);

		assert.strictEqual(fired, true);
	});

	test('updates filtering after configuration change', async () => {
		configService.setUserConfiguration(AgentNetworkDomainSettingId.AllowedNetworkDomains, ['example.com']);
		const service = await createService();
		assert.strictEqual(service.isUriAllowed(URI.parse('https://example.com')), true);

		configService.setUserConfiguration(AgentNetworkDomainSettingId.DeniedNetworkDomains, ['example.com']);
		fireConfigChange(AgentNetworkDomainSettingId.DeniedNetworkDomains);

		assert.strictEqual(service.isUriAllowed(URI.parse('https://example.com')), false);
	});

});
