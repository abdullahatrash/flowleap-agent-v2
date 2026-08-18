/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import { isNativeUpdaterArmed, isStampedVersion, shouldRunUpdateCheck } from '../updateNotifier/updateGate';

/**
 * Unit tests for the pure update-check gate (issue #234). These deliberately
 * import no `vscode` API so they run under plain mocha on the compiled output:
 *
 *   npx tsc -p extensions/flowleap
 *   npx mocha extensions/flowleap/out/test/updateGate.test.js --ui tdd
 */
suite('updateGate', () => {

	test('background-check eligibility per build flavor', () => {
		const results = {
			// Stamped production build where the native updater is armed:
			// the Notify-Only Checker's background checks are suppressed so the
			// user never sees two competing update surfaces.
			nativeUpdaterArmed: shouldRunUpdateCheck('background', { nativeUpdaterArmed: true, productionExtensionMode: true, stampedVersion: true }),
			// Windows build: the native updater is not armed there (its
			// product configuration is not stamped with an update URL), so the
			// toast stays active.
			windowsNativeUpdaterDisabled: shouldRunUpdateCheck('background', { nativeUpdaterArmed: false, productionExtensionMode: true, stampedVersion: true }),
			// Dev build (extension host not in production mode): never checks
			// in the background, exactly as today.
			devBuild: shouldRunUpdateCheck('background', { nativeUpdaterArmed: false, productionExtensionMode: false, stampedVersion: true }),
			// Unstamped placeholder build: never nags.
			unstampedBuild: shouldRunUpdateCheck('background', { nativeUpdaterArmed: false, productionExtensionMode: true, stampedVersion: false })
		};

		assert.deepStrictEqual(results, {
			nativeUpdaterArmed: false,
			windowsNativeUpdaterDisabled: true,
			devBuild: false,
			unstampedBuild: false
		});
	});

	test('manual command is exempt on every build', () => {
		const everyFlavor = [
			{ nativeUpdaterArmed: true, productionExtensionMode: true, stampedVersion: true },
			{ nativeUpdaterArmed: false, productionExtensionMode: true, stampedVersion: true },
			{ nativeUpdaterArmed: false, productionExtensionMode: false, stampedVersion: true },
			{ nativeUpdaterArmed: true, productionExtensionMode: false, stampedVersion: false }
		];

		assert.deepStrictEqual(everyFlavor.map(state => shouldRunUpdateCheck('manual', state)), [true, true, true, true]);
	});

	test('native updater is armed only by a fully stamped product configuration', () => {
		const results = {
			fullyStamped: isNativeUpdaterArmed({ updateUrl: 'https://www.flowleap.co/api/update', quality: 'stable', commit: 'abc123' }),
			noUpdateUrl: isNativeUpdaterArmed({ quality: 'stable', commit: 'abc123' }),
			noQuality: isNativeUpdaterArmed({ updateUrl: 'https://www.flowleap.co/api/update', commit: 'abc123' }),
			noCommit: isNativeUpdaterArmed({ updateUrl: 'https://www.flowleap.co/api/update', quality: 'stable' }),
			// Unreadable / unparsable product.json fails open to the toast.
			unreadable: isNativeUpdaterArmed(undefined)
		};

		assert.deepStrictEqual(results, {
			fullyStamped: true,
			noUpdateUrl: false,
			noQuality: false,
			noCommit: false,
			unreadable: false
		});
	});

	test('placeholder versions are not stamped', () => {
		assert.deepStrictEqual(
			['1.2.3', '0.0.0', '0.0.1', ''].map(isStampedVersion),
			[true, false, false, false]
		);
	});
});
