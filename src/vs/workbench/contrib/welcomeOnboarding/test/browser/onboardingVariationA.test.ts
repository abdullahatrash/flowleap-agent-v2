/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IExtensionGalleryService, IExtensionManagementService } from '../../../../../platform/extensionManagement/common/extensionManagement.js';
import { ILayoutService } from '../../../../../platform/layout/browser/layoutService.js';
import { ColorThemeData } from '../../../../services/themes/common/colorThemeData.js';
import { IWorkbenchThemeService } from '../../../../services/themes/common/workbenchThemeService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { OnboardingVariationA } from '../../browser/onboardingVariationA.js';
import { ONBOARDING_ROLE_OPTIONS } from '../../common/onboardingTypes.js';

suite('OnboardingVariationA', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('opens on the FlowLeap Role step with no GitHub sign-in disclaimer', () => {
		const container = mainWindow.document.body.appendChild($('div'));
		store.add(toDisposable(() => container.remove()));
		const instantiationService = workbenchInstantiationService(undefined, store);
		instantiationService.stub(ILayoutService, { activeContainer: container });
		instantiationService.stub(IWorkbenchThemeService, { getColorTheme: () => ColorThemeData.createLoadedEmptyTheme('test', '') });
		instantiationService.stub(IExtensionGalleryService, {});
		instantiationService.stub(IExtensionManagementService, {});
		const onboarding = store.add(instantiationService.createInstance(OnboardingVariationA));
		onboarding.show();

		const roleCards = Array.from(container.querySelectorAll<HTMLElement>('.onboarding-a-role-card'));
		assert.deepStrictEqual({
			roleCards: roleCards.map(card => card.dataset.id),
			githubDisclaimer: container.querySelector('.onboarding-a-signin-disclaimer') !== null,
		}, {
			roleCards: ONBOARDING_ROLE_OPTIONS.map(option => option.id),
			githubDisclaimer: false,
		});
	});
});
