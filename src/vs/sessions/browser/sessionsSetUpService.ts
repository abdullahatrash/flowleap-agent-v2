/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/sessionsSetUp.css';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../base/common/lifecycle.js';
import { DeferredPromise } from '../../base/common/async.js';
import { createDecorator, IInstantiationService } from '../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../platform/storage/common/storage.js';
import { IUserDataProfileStorageService } from '../../platform/userDataProfile/common/userDataProfileStorageService.js';
import { IUserDataProfilesService } from '../../platform/userDataProfile/common/userDataProfile.js';
import { ServiceCollection } from '../../platform/instantiation/common/serviceCollection.js';
import { ChatEntitlementContext, IChatEntitlementService } from '../../workbench/services/chat/common/chatEntitlementService.js';
import { isWeb } from '../../base/common/platform.js';
import { IProductService } from '../../platform/product/common/productService.js';
import { IContextKeyService } from '../../platform/contextkey/common/contextkey.js';
import { IWorkbenchEnvironmentService } from '../../workbench/services/environment/common/environmentService.js';
import { IWorkbenchLayoutService } from '../../workbench/services/layout/browser/layoutService.js';
import { IKeybindingService } from '../../platform/keybinding/common/keybinding.js';
import { IHostService } from '../../workbench/services/host/browser/host.js';
import { WELCOME_COMPLETE_KEY } from '../common/welcome.js';
import { SessionsWelcomeVisibleContext } from '../common/contextkeys.js';

import { IConfigurationService } from '../../platform/configuration/common/configuration.js';
import { Codicon } from '../../base/common/codicons.js';
import { Dialog, DialogContentsAlignment } from '../../base/browser/ui/dialog/dialog.js';
import { createWorkbenchDialogOptions } from '../../workbench/browser/parts/dialogs/dialog.js';
import { localize } from '../../nls.js';

const AIDisabledConfig = 'chat.disableAIFeatures';

/**
 * Completion key for the onboarding wizard, owned by
 * `workbench/contrib/welcomeOnboarding/common/onboardingTypes` (`ONBOARDING_STORAGE_KEY`). Mirrored
 * here as a string literal so this layer can suppress the duplicate welcome dialog without importing
 * a workbench contrib (issue #79 consolidation).
 */
const ONBOARDING_WIZARD_STATE_KEY = 'welcomeOnboarding.state';

export const ISessionsSetUpService = createDecorator<ISessionsSetUpService>('sessionsSetUpService');

export interface ISessionsSetUpService {
	readonly _serviceBrand: undefined;
	/**
	 * Resolves when the welcome/setup flow has completed (or immediately
	 * if it is not currently active). Use this to defer work until after
	 * the user has finished the initial sign-in or setup dialog.
	 */
	whenWelcomeDone(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal welcome widget — owns all the welcome UI logic.
// Receives service callbacks as constructor params to avoid circular injection.
// ---------------------------------------------------------------------------

function shouldSkipSessionsWelcome(environmentService: IWorkbenchEnvironmentService): boolean {
	if (environmentService.enableSmokeTestDriver) {
		return true;
	}
	const envArgs = (environmentService as IWorkbenchEnvironmentService & { args?: Record<string, unknown> }).args;
	if (envArgs?.['skip-sessions-welcome']) {
		return true;
	}
	return typeof globalThis.location !== 'undefined' && new URLSearchParams(globalThis.location.search).has('skip-sessions-welcome');
}

class SessionsSetUpWidget extends Disposable {

	private readonly dialogRef = this._register(new MutableDisposable<DisposableStore>());
	private readonly watcherRef = this._register(new MutableDisposable());

	// Non-service params must come before @-decorated service params
	constructor(
		private readonly onCompleted: () => void,
		private readonly serviceMarkDone: () => void,
		@IProductService private readonly productService: IProductService,
		@IStorageService private readonly storageService: IStorageService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IHostService private readonly hostService: IHostService,
	) {
		super();
		this._start();
	}

	private _start(): void {
		if (!this.productService.defaultChatAgent?.chatExtensionId) {
			this.onCompleted();
			return;
		}

		if (shouldSkipSessionsWelcome(this.environmentService)) {
			this.onCompleted();
			return;
		}

		void this._run();
	}

	/**
	 * Agents run against Claude-native credentials (or a BYOK key), so there is
	 * no GitHub/Copilot sign-in gate. First launch shows a lightweight welcome
	 * dialog; afterwards the window opens straight into the sessions list.
	 */
	private async _run(): Promise<void> {
		await this._ensureAIFeaturesEnabled();

		const isFirstLaunch = !this.storageService.getBoolean(WELCOME_COMPLETE_KEY, StorageScope.APPLICATION, false);
		// The onboarding wizard (issue #79) is the single first-run welcome. When it has already run
		// its own richer welcome, don't stack this dialog on top — record completion silently instead.
		// The key is referenced by string (owned by welcomeOnboarding/common/onboardingTypes) so this
		// layer never imports a workbench contrib.
		const onboardingWizardRan = this.storageService.getBoolean(ONBOARDING_WIZARD_STATE_KEY, StorageScope.APPLICATION, false);
		// The welcome dialog is desktop-only; on web we open straight in.
		if (onboardingWizardRan) {
			this.storageService.store(WELCOME_COMPLETE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
			this.serviceMarkDone();
		} else if (isFirstLaunch && !isWeb) {
			await this._showWelcomeDialog();
		}

		this.onCompleted();
		this.watcherRef.value = this._watchAIDisabledState();
	}

	private _watchAIDisabledState(): IDisposable {
		return this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AIDisabledConfig)) {
				if (this.configurationService.getValue<boolean>(AIDisabledConfig)) {
					this._showAIDisabledDialog();
				} else {
					// AI features re-enabled — dismiss any AI disabled dialog
					this.dialogRef.clear();
				}
			}
		});
	}

	private async _ensureAIFeaturesEnabled(): Promise<void> {
		if (this.configurationService.getValue<boolean>(AIDisabledConfig)) {
			this.logService.info('[sessions welcome] AI features disabled, enabling');
			await this.configurationService.updateValue(AIDisabledConfig, false);
		}
	}

	private async _showAIDisabledDialog(): Promise<void> {
		if (this.dialogRef.value) {
			return;
		}

		this.logService.info('[sessions welcome] AI features disabled, showing enable dialog');

		const disposables = new DisposableStore();
		this.dialogRef.value = disposables;

		const welcomeVisibleKey = SessionsWelcomeVisibleContext.bindTo(this.contextKeyService);
		welcomeVisibleKey.set(true);
		disposables.add(toDisposable(() => welcomeVisibleKey.reset()));

		const dialog = disposables.add(new Dialog(
			this.layoutService.activeContainer,
			'',
			[localize('sessions.aiDisabled.enable', "Enable AI Features")],
			createWorkbenchDialogOptions({
				type: 'none',
				extraClasses: ['chat-setup-dialog', 'sessions-welcome-dialog'],
				detail: localize('sessions.aiDisabled.detail', "Enable AI features to continue using Agents."),
				icon: Codicon.agent,
				alignment: DialogContentsAlignment.Vertical,
				cancelId: 1,
				disableCloseButton: true,
				disableCloseAction: true,
			}, this.keybindingService, this.layoutService, this.hostService)
		));

		const { button } = await dialog.show();
		disposables.dispose();
		this.dialogRef.clear();

		if (button === 0) {
			this.logService.info('[sessions welcome] User chose to enable AI features');
			await this.configurationService.updateValue(AIDisabledConfig, false);
		}
	}

	private async _showWelcomeDialog(): Promise<void> {
		if (this.dialogRef.value) {
			return;
		}

		this.logService.info('[sessions welcome] Showing welcome dialog');

		const disposables = new DisposableStore();
		this.dialogRef.value = disposables;

		const welcomeVisibleKey = SessionsWelcomeVisibleContext.bindTo(this.contextKeyService);
		welcomeVisibleKey.set(true);
		disposables.add(toDisposable(() => welcomeVisibleKey.reset()));

		const productName = localize('walkthrough.productName', "{0} - Agents", this.productService.nameLong);

		const dialog = disposables.add(new Dialog(
			this.layoutService.activeContainer,
			localize('sessions.welcome.title', "Welcome to {0}", productName),
			[localize('sessions.welcome.getStarted', "Get Started")],
			createWorkbenchDialogOptions({
				type: 'none',
				extraClasses: ['chat-setup-dialog', 'sessions-welcome-dialog', 'sessions-main-welcome-dialog'],
				detail: localize('sessions.welcome.detail', "Your AI-powered patent workspace where agents research, analyze, and draft with you."),
				icon: Codicon.agent,
				alignment: DialogContentsAlignment.Vertical,
				cancelId: 1,
				disableCloseButton: true,
			}, this.keybindingService, this.layoutService, this.hostService)
		));

		await dialog.show();
		this.dialogRef.clear();

		this.storageService.store(WELCOME_COMPLETE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.serviceMarkDone();
	}
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SessionsSetUpService extends Disposable implements ISessionsSetUpService {

	declare readonly _serviceBrand: undefined;

	private readonly _welcomeDoneDeferred = new DeferredPromise<void>();

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IUserDataProfileStorageService private readonly userDataProfileStorageService: IUserDataProfileStorageService,
		@IUserDataProfilesService private readonly userDataProfilesService: IUserDataProfilesService,
		@IChatEntitlementService private readonly chatEntitlementService: IChatEntitlementService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		void this.initialize();

		this._register(this.instantiationService.createInstance(
			SessionsSetUpWidget,
			() => this._welcomeDoneDeferred.complete(),
			() => this.markDone()
		));
	}

	private markDone(): void {
		this.chatEntitlementService.markSetupCompleted();
	}

	whenWelcomeDone(): Promise<void> {
		return this._welcomeDoneDeferred.p;
	}

	private async initialize(): Promise<void> {
		if (this.chatEntitlementService.sentiment.completed) {
			return;
		}

		try {
			const defaultProfile = this.userDataProfilesService.defaultProfile;
			await this.userDataProfileStorageService.withProfileScopedStorageService(defaultProfile, async storageService => {
				const defaultContext = this.instantiationService
					.createChild(new ServiceCollection([IStorageService, storageService]))
					.createInstance(ChatEntitlementContext);
				try {
					if (defaultContext.state.completed) {
						this.logService.info('[sessions welcome] Setup already completed in default profile, marking done locally');
						this.markDone();
					}
				} finally {
					defaultContext.dispose();
				}
			});
		} catch (error) {
			this.logService.error('[sessions welcome] Failed to read setup state from default profile:', error);
		}
	}
}
