/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { $, append, addDisposableListener, EventType, clearNode, getActiveWindow } from '../../../../base/browser/dom.js';
import { URI } from '../../../../base/common/uri.js';
import { isWindows, isMacintosh, isLinux } from '../../../../base/common/platform.js';
import { FileAccess } from '../../../../base/common/network.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { localize } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { IWorkbenchThemeService } from '../../../services/themes/common/workbenchThemeService.js';
import { EXTENSION_INSTALL_SKIP_WALKTHROUGH_CONTEXT, IExtensionGalleryService, IExtensionManagementService } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import product from '../../../../platform/product/common/product.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import {
	OnboardingStepId,
	ONBOARDING_AI_PREFERENCE_OPTIONS,
	ONBOARDING_ROLE_OPTIONS,
	ONBOARDING_ROLE_STORAGE_KEY,
	AiCollaborationMode,
	OnboardingRole,
	IOnboardingThemeOption,
	SubscriptionAccess,
	computeVisibleSteps,
	decideTrialPoll,
	getOnboardingStepTitle,
	getOnboardingStepSubtitle,
	TRIAL_POLL_INTERVAL_MS,
} from '../common/onboardingTypes.js';
import { IOnboardingService } from '../common/onboardingService.js';

type OnboardingStepViewClassification = {
	owner: 'cwebster-99';
	comment: 'Tracks which onboarding step is viewed.';
	step: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The step identifier.' };
	stepNumber: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'The 1-based step index.' };
};

type OnboardingStepViewEvent = {
	step: string;
	stepNumber: number;
};

type OnboardingActionClassification = {
	owner: 'cwebster-99';
	comment: 'Tracks actions taken on the onboarding wizard.';
	action: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The action performed.' };
	step: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The step the action was performed on.' };
	argument: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Optional context such as theme id, extension id, or provider.' };
};

type OnboardingActionEvent = {
	action: string;
	step: string;
	argument: string | undefined;
};

/**
 * Context key (owned by the FlowLeap extension, PRD 0002 Issue 4) mirroring whether a FlowLeap
 * Session exists. Referenced here by string on purpose so core never becomes a second owner of it.
 */
const FLOWLEAP_SIGNED_IN_CONTEXT_KEY = 'flowleap.signedIn';

/**
 * Variation A — Classic Wizard Modal
 *
 * A centered modal overlay with progress dots, clean step transitions,
 * and polished navigation. Sits on top of the agent sessions welcome
 * tab. When dismissed, the welcome tab is revealed underneath.
 *
 * Steps (patent-persona funnel, issue #79): Role → See it work → Sign in → Trial → Model.
 * 1. Role — "What brings you to FlowLeap?" persona picker (patent attorney / IP analyst /
 *    researcher / founder). The choice is persisted and tailors later phases.
 * 2. See it work — the "Build with AI Agents" placeholder demo (unchanged in P1).
 * 3. Sign In — FlowLeap sign-in hero (a single "Continue with FlowLeap" action). Soft, not a hard
 *    gate: the modal stays dismissable and "Continue without Signing In" is offered (see ADR 0003).
 * 4. Trial — value-framed 7-day trial; only shown when signed in. Opens checkout in the browser
 *    and polls the subscription, auto-advancing when it turns active/trialing.
 * 5. Model — connect a BYO AI model (OpenRouter recommended); reflects an already-connected model.
 *
 * The legacy Personalize (theme/keymap) and AiPreference steps are no longer in the flow; their
 * render code is retained (referenced by the `_renderStep` switch) but never reached, and a sensible
 * default theme is applied silently instead of asking (issue #79 principle 4).
 */
export class OnboardingVariationA extends Disposable implements IOnboardingService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidComplete = this._register(new Emitter<void>());
	readonly onDidComplete: Event<void> = this._onDidComplete.event;

	private readonly _onDidDismiss = this._register(new Emitter<void>());
	readonly onDidDismiss: Event<void> = this._onDidDismiss.event;

	private overlay: HTMLElement | undefined;
	private card: HTMLElement | undefined;
	private bodyEl: HTMLElement | undefined;
	private progressContainer: HTMLElement | undefined;
	private stepLabelEl: HTMLElement | undefined;
	private titleEl: HTMLElement | undefined;
	private subtitleEl: HTMLElement | undefined;
	private contentEl: HTMLElement | undefined;
	private backButton: HTMLButtonElement | undefined;
	private nextButton: HTMLButtonElement | undefined;
	private closeButton: HTMLButtonElement | undefined;
	private footerLeft: HTMLElement | undefined;
	private _footerSignInBtn: HTMLButtonElement | undefined;

	private currentStepIndex = 0;
	private steps: OnboardingStepId[] = computeVisibleSteps({ signedIn: false });
	private readonly disposables = this._register(new DisposableStore());
	private readonly stepDisposables = this._register(new DisposableStore());
	private previouslyFocusedElement: HTMLElement | undefined;
	private _isShowing = false;

	private readonly footerFocusableElements: HTMLElement[] = [];
	private readonly stepFocusableElements: HTMLElement[] = [];
	private selectedThemeId = 'dark-2026';
	private selectedKeymapId = 'vscode';
	private _detectedEditorIds: Set<string> | undefined;
	private _userSignedIn = false;
	private _signInInFlight = false;
	private _signInError: string | undefined;
	private selectedAiMode: AiCollaborationMode = AiCollaborationMode.Balanced;
	private selectedRole: OnboardingRole | undefined;
	// Trial subscription poll. `_trialPollToken` invalidates any in-flight tick when the poll is
	// stopped (step change, dispose, or a resolved advance) so a late async result can't act stale.
	private _trialPollHandle: number | undefined;
	private _trialPollToken = 0;
	// Fire `model_key_added` at most once per wizard run.
	private _modelKeyAddedLogged = false;

	constructor(
		@ILayoutService private readonly layoutService: ILayoutService,
		@IWorkbenchThemeService private readonly themeService: IWorkbenchThemeService,
		@IExtensionGalleryService private readonly extensionGalleryService: IExtensionGalleryService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INotificationService private readonly notificationService: INotificationService,
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ICommandService private readonly commandService: ICommandService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();

		// Detect currently active theme
		const currentTheme = this.themeService.getColorTheme();
		const allThemes = product.onboardingThemes ?? [];
		const matchingTheme = allThemes.find(t => t.themeId === currentTheme.settingsId);
		if (matchingTheme) {
			this.selectedThemeId = matchingTheme.id;
		}

		// Pre-select a previously stored role so a wizard re-trigger resumes sensibly (ADR 0003).
		const storedRole = this.storageService.get(ONBOARDING_ROLE_STORAGE_KEY, StorageScope.APPLICATION);
		if (ONBOARDING_ROLE_OPTIONS.some(o => o.id === storedRole)) {
			this.selectedRole = storedRole as OnboardingRole;
		}

		// Start detecting installed editors early so results are ready if the Personalize step ever runs.
		this._detectInstalledEditors().then(ids => { this._detectedEditorIds = ids; });
	}

	get isShowing(): boolean {
		return this._isShowing;
	}

	show(): void {
		if (this.overlay) {
			return;
		}

		this._isShowing = true;
		this._modelKeyAddedLogged = false;
		this._userSignedIn = this.contextKeyService.getContextKeyValue<boolean>(FLOWLEAP_SIGNED_IN_CONTEXT_KEY) === true;
		this._recomputeSteps();
		this._applySilentThemeDefault();
		this._logAction('wizard_started', this.steps[0]);
		this.previouslyFocusedElement = getActiveWindow().document.activeElement as HTMLElement | undefined;

		const container = this.layoutService.activeContainer;

		// Overlay
		this.overlay = append(container, $('.onboarding-a-overlay'));
		this.overlay.setAttribute('role', 'dialog');
		this.overlay.setAttribute('aria-modal', 'true');
		this.overlay.setAttribute('aria-label', localize('onboarding.a.aria', "Welcome to Visual Studio Code"));

		// Card
		this.card = append(this.overlay, $('.onboarding-a-card'));

		// Close button (upper-right corner of card)
		this.closeButton = append(this.card, $<HTMLButtonElement>('button.onboarding-a-close-btn'));
		this.closeButton.type = 'button';
		this.closeButton.setAttribute('aria-label', localize('onboarding.close', "Close"));
		this.closeButton.appendChild(renderIcon(Codicon.close));

		// Header with progress
		const header = append(this.card, $('.onboarding-a-header'));
		this.progressContainer = append(header, $('.onboarding-a-progress'));
		this.stepLabelEl = append(this.progressContainer, $('span.onboarding-a-step-label'));
		this._renderProgress();

		// Body
		this.bodyEl = append(this.card, $('.onboarding-a-body'));
		this.titleEl = append(this.bodyEl, $('h2.onboarding-a-step-title'));
		this.subtitleEl = append(this.bodyEl, $('p.onboarding-a-step-subtitle'));
		this.contentEl = append(this.bodyEl, $('.onboarding-a-step-content'));
		this._renderStep();
		this._logStepView();

		// Footer
		const footer = append(this.card, $('.onboarding-a-footer'));

		this.footerLeft = append(footer, $('.onboarding-a-footer-left'));

		const footerRight = append(footer, $('.onboarding-a-footer-right'));

		this.backButton = append(footerRight, $<HTMLButtonElement>('button.onboarding-a-btn.onboarding-a-btn-secondary'));
		this.backButton.textContent = localize('onboarding.back', "Back");
		this.backButton.type = 'button';
		this.footerFocusableElements.push(this.backButton);

		this.nextButton = append(footerRight, $<HTMLButtonElement>('button.onboarding-a-btn.onboarding-a-btn-primary'));
		this.nextButton.type = 'button';
		this.footerFocusableElements.push(this.nextButton);
		this._updateButtonStates();

		// Event handlers
		this.disposables.add(addDisposableListener(this.closeButton, EventType.CLICK, () => {
			this._logAction('skip');
			this._dismiss('skip');
		}));
		this.disposables.add(addDisposableListener(this.backButton, EventType.CLICK, () => {
			this._logAction('back');
			this._prevStep();
		}));
		this.disposables.add(addDisposableListener(this.nextButton, EventType.CLICK, () => {
			if (this._isLastStep()) {
				this._logAction('complete');
				this._dismiss('complete');
				return;
			}
			this._logFooterAdvance(this.steps[this.currentStepIndex]);
			this._nextStep();
		}));

		this.disposables.add(addDisposableListener(this.overlay, EventType.MOUSE_DOWN, (e: MouseEvent) => {
			if (e.target === this.overlay) {
				this._dismiss('skip');
			}
		}));

		this.disposables.add(addDisposableListener(this.overlay, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);

			// Prevent all keyboard shortcuts from reaching the keybinding service
			e.stopPropagation();

			if (event.keyCode === KeyCode.Escape) {
				e.preventDefault();
				this._dismiss('skip');
				return;
			}

			if (event.keyCode === KeyCode.Tab) {
				this._trapTab(e, event.shiftKey);
			}
		}));

		// Entrance animation
		this.overlay.classList.add('entering');
		getActiveWindow().requestAnimationFrame(() => {
			this.overlay?.classList.remove('entering');
			this.overlay?.classList.add('visible');
		});

		this._focusCurrentStepElement();
	}

	private _dismiss(reason: 'complete' | 'skip'): void {
		if (!this.overlay) {
			return;
		}

		this._logAction('dismiss', undefined, reason);

		this.overlay.classList.remove('visible');
		this.overlay.classList.add('exiting');

		let handled = false;
		const onTransitionEnd = () => {
			if (handled) {
				return;
			}
			handled = true;
			this._removeFromDOM();
			if (reason === 'complete') {
				this._onDidComplete.fire();
			}
			this._onDidDismiss.fire();
		};

		this.overlay.addEventListener('transitionend', onTransitionEnd, { once: true });
		setTimeout(onTransitionEnd, 400);
	}

	private _nextStep(): void {
		if (this.currentStepIndex < this.steps.length - 1) {
			const leavingStep = this.steps[this.currentStepIndex];
			if (leavingStep === OnboardingStepId.Personalize) {
				this._applyKeymap(this.selectedKeymapId);
			}
			this.currentStepIndex++;
			this._renderStep();
			this._renderProgress();
			this._updateButtonStates();
			this._focusCurrentStepElement();
			this._logStepView();
		}
	}

	/**
	 * Recompute the visible steps from the current sign-in state, preserving the step the user is on.
	 * Called at {@link show} and after a successful sign-in (which unlocks the Trial step).
	 */
	private _recomputeSteps(): void {
		const currentStepId = this.steps[this.currentStepIndex];
		this.steps = computeVisibleSteps({ signedIn: this._userSignedIn });
		const newIndex = this.steps.indexOf(currentStepId);
		this.currentStepIndex = newIndex >= 0 ? newIndex : Math.min(this.currentStepIndex, this.steps.length - 1);
	}

	/**
	 * Log the first-class skip/advance telemetry for leaving a step via the footer primary button.
	 * The role/theme captures and demo completion are the P1 funnel signals (issue #79).
	 */
	private _logFooterAdvance(stepId: OnboardingStepId): void {
		switch (stepId) {
			case OnboardingStepId.Role:
				if (!this.selectedRole) {
					this._logAction('role_skipped');
				}
				break;
			case OnboardingStepId.AgentSessions:
				this._logAction('demo_completed');
				break;
			case OnboardingStepId.SignIn:
				if (!this._userSignedIn) {
					this._logAction('signin_skipped');
				}
				break;
			case OnboardingStepId.Trial:
				this._stopTrialPoll();
				this._logAction('trial_skipped');
				break;
			default:
				this._logAction('next');
		}
	}

	/**
	 * Apply the brand default theme silently on first onboarding. The Personalize step was removed
	 * (issue #79), so instead of asking we set the default once; a re-trigger (a role is already
	 * stored) leaves the user's later theme choice untouched.
	 */
	private _applySilentThemeDefault(): void {
		if (this.storageService.get(ONBOARDING_ROLE_STORAGE_KEY, StorageScope.APPLICATION)) {
			return;
		}
		const defaultTheme = (product.onboardingThemes ?? []).find(t => t.id === this.selectedThemeId);
		if (defaultTheme) {
			void this._selectTheme(defaultTheme);
		}
	}

	private _prevStep(): void {
		if (this.currentStepIndex > 0) {
			this.currentStepIndex--;
			this._renderStep();
			this._renderProgress();
			this._updateButtonStates();
			this._focusCurrentStepElement();
			this._logStepView();
		}
	}

	private _isLastStep(): boolean {
		return this.currentStepIndex === this.steps.length - 1;
	}

	private _renderProgress(): void {
		if (!this.progressContainer || !this.stepLabelEl) {
			return;
		}

		clearNode(this.progressContainer);

		for (let i = 0; i < this.steps.length; i++) {
			const dot = append(this.progressContainer, $('span.onboarding-a-progress-dot'));
			if (i === this.currentStepIndex) {
				dot.classList.add('active');
			} else if (i < this.currentStepIndex) {
				dot.classList.add('completed');
			}
		}

		this.progressContainer.appendChild(this.stepLabelEl);
		this.stepLabelEl.textContent = localize(
			'onboarding.stepOf',
			"{0} of {1}",
			this.currentStepIndex + 1,
			this.steps.length
		);
	}

	private _renderStep(): void {
		if (!this.titleEl || !this.subtitleEl || !this.contentEl) {
			return;
		}

		this.stepDisposables.clear();
		this.stepFocusableElements.length = 0;

		const stepId = this.steps[this.currentStepIndex];
		const useSignInHero = stepId === OnboardingStepId.SignIn;
		this.titleEl.style.display = useSignInHero ? 'none' : '';
		this.subtitleEl.style.display = useSignInHero ? 'none' : '';
		this.titleEl.textContent = getOnboardingStepTitle(stepId);
		if (stepId === OnboardingStepId.AgentSessions) {
			this._renderAgentSessionsSubtitle(this.subtitleEl);
		} else if (stepId === OnboardingStepId.Personalize) {
			this._renderPersonalizeSubtitle(this.subtitleEl);
		} else {
			this.subtitleEl.textContent = getOnboardingStepSubtitle(stepId);
		}

		clearNode(this.contentEl);

		switch (stepId) {
			case OnboardingStepId.Role:
				this._renderRoleStep(this.contentEl);
				break;
			case OnboardingStepId.SignIn:
				this._renderSignInStep(this.contentEl);
				break;
			case OnboardingStepId.Personalize:
				this._renderPersonalizeStep(this.contentEl);
				break;
			case OnboardingStepId.AiPreference:
				this._renderAiPreferenceStep(this.contentEl);
				break;
			case OnboardingStepId.AgentSessions:
				this._renderAgentSessionsStep(this.contentEl);
				break;
			case OnboardingStepId.Trial:
				this._renderTrialStep(this.contentEl);
				break;
			case OnboardingStepId.Model:
				this._renderModelStep(this.contentEl);
				break;
		}

		this.bodyEl?.setAttribute('aria-label', localize(
			'onboarding.step.aria',
			"Step {0} of {1}: {2}",
			this.currentStepIndex + 1,
			this.steps.length,
			getOnboardingStepTitle(stepId)
		));
	}

	private _updateButtonStates(): void {
		if (this.backButton) {
			this.backButton.style.display = this.currentStepIndex === 0 ? 'none' : '';
		}
		if (this.nextButton) {
			const { className, label } = this._footerNextButtonState(this.steps[this.currentStepIndex]);
			this.nextButton.className = className;
			this.nextButton.textContent = label;
		}
		if (this.footerLeft) {
			if (this._isLastStep()) {
				// Show sign-in nudge in footer
				if (!this._footerSignInBtn && !this._userSignedIn) {
					this._footerSignInBtn = append(this.footerLeft, $<HTMLButtonElement>('button.onboarding-a-signin-nudge-btn'));
					this._footerSignInBtn.type = 'button';
					this._footerSignInBtn.textContent = localize('onboarding.sessions.signInNudge', "Sign in to FlowLeap");
					this.stepDisposables.add(addDisposableListener(this._footerSignInBtn, EventType.CLICK, async () => {
						this._logAction('signInNudge');
						await this._handleSignIn();
						if (this._userSignedIn && this._footerSignInBtn) {
							this._footerSignInBtn.style.display = 'none';
						}
					}));
				}
			} else {
				if (this._footerSignInBtn) {
					this._footerSignInBtn.remove();
					this._footerSignInBtn = undefined;
				}
			}
		}
	}

	/**
	 * The label + styling for the footer primary button on a given step. The last step always
	 * completes ("Done"); the Sign In step degrades to a secondary "Continue without Signing In"
	 * when signed out (ADR 0003); the Trial step's footer is the "Decide later" skip.
	 */
	private _footerNextButtonState(stepId: OnboardingStepId): { className: string; label: string } {
		const primary = 'onboarding-a-btn onboarding-a-btn-primary';
		const secondary = 'onboarding-a-btn onboarding-a-btn-secondary';
		if (this._isLastStep()) {
			return { className: primary, label: localize('onboarding.done', "Done") };
		}
		switch (stepId) {
			case OnboardingStepId.SignIn:
				return this._userSignedIn
					? { className: primary, label: localize('onboarding.continue', "Continue") }
					: { className: secondary, label: localize('onboarding.continueWithoutSignIn', "Continue without Signing In") };
			case OnboardingStepId.Trial:
				return { className: secondary, label: localize('onboarding.trial.decideLater', "Decide later") };
			default:
				return { className: primary, label: localize('onboarding.next', "Continue") };
		}
	}

	// =====================================================================
	// Step: Role
	// =====================================================================

	private _renderRoleStep(container: HTMLElement): void {
		const wrapper = append(container, $('.onboarding-a-role'));

		const cards = append(wrapper, $('.onboarding-a-role-cards'));
		cards.setAttribute('role', 'radiogroup');
		cards.setAttribute('aria-label', localize('onboarding.role.label', "What brings you to FlowLeap?"));

		const allCards: HTMLButtonElement[] = [];
		for (const option of ONBOARDING_ROLE_OPTIONS) {
			const card = this._registerStepFocusable(append(cards, $<HTMLButtonElement>('button.onboarding-a-role-card')));
			card.type = 'button';
			card.dataset.id = option.id;
			card.setAttribute('role', 'radio');
			card.setAttribute('aria-checked', option.id === this.selectedRole ? 'true' : 'false');
			allCards.push(card);

			if (option.id === this.selectedRole) {
				card.classList.add('selected');
			}

			const iconEl = append(card, $('span.onboarding-a-role-card-icon'));
			iconEl.setAttribute('aria-hidden', 'true');
			const icon = Codicon[option.icon as keyof typeof Codicon] ?? Codicon.sparkle;
			iconEl.appendChild(renderIcon(icon));

			const titleEl = append(card, $('div.onboarding-a-role-card-title'));
			titleEl.textContent = option.label;

			const descEl = append(card, $('div.onboarding-a-role-card-desc'));
			descEl.textContent = option.description;

			this.stepDisposables.add(addDisposableListener(card, EventType.CLICK, () => {
				this._selectRole(option.id);
				for (const c of allCards) {
					c.classList.toggle('selected', c.dataset.id === option.id);
					c.setAttribute('aria-checked', c.dataset.id === option.id ? 'true' : 'false');
				}
				this.accessibilityService.alert(localize('onboarding.role.selected.alert', "{0} selected", option.label));
			}));
		}
		const selectedRoleIndex = ONBOARDING_ROLE_OPTIONS.findIndex(o => o.id === this.selectedRole);
		this._setupRadioGroupNavigation(allCards, Math.max(0, selectedRoleIndex));

		// Subtle "Just exploring" skip — advances without capturing a role (issue #79 flow, step 1).
		const skip = this._registerStepFocusable(append(wrapper, $<HTMLButtonElement>('button.onboarding-a-role-skip')));
		skip.type = 'button';
		skip.textContent = localize('onboarding.role.skip', "Just exploring");
		this.stepDisposables.add(addDisposableListener(skip, EventType.CLICK, () => {
			this._logAction('role_skipped');
			this._nextStep();
		}));
	}

	private _selectRole(role: OnboardingRole): void {
		this.selectedRole = role;
		this.storageService.store(ONBOARDING_ROLE_STORAGE_KEY, role, StorageScope.APPLICATION, StorageTarget.USER);
		this._logAction('role_selected', OnboardingStepId.Role, role);
	}

	// =====================================================================
	// Step: Sign In
	// =====================================================================

	private _renderSignInStep(container: HTMLElement): void {
		const wrapper = append(container, $('.onboarding-a-signin'));
		const brand = append(wrapper, $('.onboarding-a-signin-brand'));
		const brandIcon = append(brand, $('span.onboarding-a-signin-brand-icon'));
		brandIcon.setAttribute('role', 'img');
		brandIcon.setAttribute('aria-label', product.nameLong);

		const content = append(wrapper, $('.onboarding-a-signin-content'));
		const contentMain = append(content, $('.onboarding-a-signin-content-main'));
		const title = append(contentMain, $('h2.onboarding-a-signin-title'));
		title.textContent = localize('onboarding.signIn.heroTitle', "Welcome to {0}", product.nameShort);

		const subtitle = append(contentMain, $('p.onboarding-a-signin-subtitle'));
		subtitle.textContent = localize('onboarding.signIn.heroSubtitle', "Sign in to unlock the patent tools and your subscription.");

		const actions = append(contentMain, $('.onboarding-a-signin-actions'));

		if (this._userSignedIn) {
			const signedIn = append(actions, $('.onboarding-a-signin-confirmation'));
			const icon = append(signedIn, $('span'));
			icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.check));
			icon.setAttribute('aria-hidden', 'true');
			const text = append(signedIn, $('span'));
			text.textContent = localize('onboarding.signIn.signedIn', "You're signed in. You can continue to the next step.");
			return;
		}

		const signInBtn = this._registerStepFocusable(this._createSignInButton(actions));
		signInBtn.disabled = this._signInInFlight;
		this.stepDisposables.add(addDisposableListener(signInBtn, EventType.CLICK, () => {
			this._logAction('signIn', undefined, 'flowleap');
			void this._handleSignIn();
		}));

		if (this._signInError) {
			const error = append(actions, $('.onboarding-a-signin-error'));
			error.setAttribute('role', 'alert');
			const errorIcon = append(error, $('span'));
			errorIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.error));
			errorIcon.setAttribute('aria-hidden', 'true');
			const errorText = append(error, $('span'));
			errorText.textContent = this._signInError;
		}
	}

	/**
	 * The single FlowLeap sign-in button. While an attempt is in flight it shows a spinner and a
	 * "Signing in…" label (disabled by the caller); otherwise it reads "Continue with FlowLeap", or
	 * "Try Again" after a failed attempt.
	 */
	private _createSignInButton(parent: HTMLElement): HTMLButtonElement {
		const btn = append(parent, $<HTMLButtonElement>('button.onboarding-a-signin-btn.primary'));
		btn.type = 'button';

		const mark = append(btn, $('span.onboarding-a-provider-mark'));
		mark.setAttribute('aria-hidden', 'true');
		if (this._signInInFlight) {
			mark.classList.add(...ThemeIcon.asClassNameArray(Codicon.loading), 'codicon-modifier-spin');
		}

		let label: string;
		if (this._signInInFlight) {
			label = localize('onboarding.signIn.inProgress', "Signing in…");
		} else if (this._signInError) {
			label = localize('onboarding.signIn.retry', "Try Again");
		} else {
			label = localize('onboarding.signIn.flowleap', "Continue with FlowLeap");
		}

		const labelEl = append(btn, $('span.onboarding-a-signin-btn-label'));
		labelEl.textContent = label;
		btn.title = label;
		btn.setAttribute('aria-label', label);
		return btn;
	}

	/**
	 * Drive the native FlowLeap sign-in (PRD 0002 #5) through the `flowleap.signIn` command with
	 * `silent:true` — a blocking overlay dims toasts, so the step renders its own inline status. On
	 * success the modal advances; on failure it resets to a "Try Again" state with an inline error.
	 */
	private async _handleSignIn(): Promise<void> {
		if (this._signInInFlight) {
			return;
		}
		const onSignInStep = this.steps[this.currentStepIndex] === OnboardingStepId.SignIn;
		this._signInInFlight = true;
		this._signInError = undefined;
		if (onSignInStep) {
			this._renderStep();
			this._updateButtonStates();
		}

		let signedIn = false;
		try {
			signedIn = await this.commandService.executeCommand<boolean>('flowleap.signIn', { silent: true }) === true;
		} catch {
			// `flowleap.signIn` lives in the copilot extension; if it isn't registered yet (activation
			// race) or it throws, surface a generic inline error rather than a hidden toast.
			this._signInError = localize('onboarding.signIn.error', "Sign-in is unavailable right now. Please try again.");
		}

		this._signInInFlight = false;

		if (signedIn) {
			this._userSignedIn = true;
			this._signInError = undefined;
			this._logAction('signin_done', OnboardingStepId.SignIn);
			// Signing in unlocks the value-framed Trial step; rebuild the flow so it appears next.
			this._recomputeSteps();
			if (this._footerSignInBtn) {
				this._footerSignInBtn.style.display = 'none';
			}
			if (onSignInStep) {
				this._nextStep();
			}
			return;
		}

		if (!this._signInError) {
			this._signInError = localize('onboarding.signIn.failed', "Sign-in didn't complete. Please try again.");
		}
		if (onSignInStep) {
			this._renderStep();
			this._updateButtonStates();
			this._focusCurrentStepElement();
		}
	}

	// =====================================================================
	// Step: Personalize (Theme + Keymap)
	// =====================================================================

	private _renderPersonalizeStep(container: HTMLElement): void {
		const wrapper = append(container, $('.onboarding-a-personalize'));

		// Theme section
		const themeLabel = append(wrapper, $('div.onboarding-a-section-label'));
		themeLabel.textContent = localize('onboarding.personalize.theme', "Color Theme");

		const themeHint = append(wrapper, $('div.onboarding-a-theme-hint'));
		themeHint.textContent = localize('onboarding.personalize.themeHint', "You can browse and install more themes later from the Extensions view.");

		const themeGrid = append(wrapper, $('.onboarding-a-theme-grid'));
		themeGrid.setAttribute('role', 'radiogroup');
		themeGrid.setAttribute('aria-label', localize('onboarding.personalize.themeLabel', "Choose a color theme"));

		const hasOtherEditors = this._hasOtherEditors();
		const allThemes = product.onboardingThemes ?? [];
		// When other editors are detected, show a compact set (exclude solarized variants).
		const themes: readonly IOnboardingThemeOption[] = hasOtherEditors
			? allThemes.filter(t => !t.id.startsWith('solarized'))
			: allThemes;

		if (!hasOtherEditors) {
			themeGrid.classList.add('theme-grid-expanded');
		}

		const themeCards: HTMLElement[] = [];
		for (const theme of themes) {
			this._createThemeCard(themeGrid, theme, themeCards);
		}
		// Make all theme cards individually tabbable
		for (const card of themeCards) {
			card.setAttribute('tabindex', '0');
		}

		// Keyboard Mapping section — only shown when another editor is detected
		const keymapOptions = this._detectedEditorIds
			? (product.onboardingKeymaps ?? []).filter(k => this._detectedEditorIds!.has(k.id))
			: [];

		if (hasOtherEditors) {
			const keymapLabel = append(wrapper, $('div.onboarding-a-section-label.onboarding-a-section-label-keymap'));
			keymapLabel.textContent = localize('onboarding.personalize.keymap', "Keyboard Mapping");

			const keymapHint = append(wrapper, $('div.onboarding-a-theme-hint'));
			keymapHint.textContent = localize('onboarding.personalize.keymapHint', "Coming from another editor? Import your keyboard mapping to feel right at home.");

			const keymapList = append(wrapper, $('.onboarding-a-keymap-list'));
			keymapList.setAttribute('role', 'radiogroup');
			keymapList.setAttribute('aria-label', localize('onboarding.personalize.keymapLabel', "Choose a keyboard mapping"));

			const keymapPills: HTMLButtonElement[] = [];
			for (const keymap of keymapOptions) {
				const pill = this._registerStepFocusable(append(keymapList, $<HTMLButtonElement>('button.onboarding-a-keymap-pill')));
				pill.type = 'button';
				pill.setAttribute('role', 'radio');
				pill.setAttribute('aria-checked', keymap.id === this.selectedKeymapId ? 'true' : 'false');
				pill.title = keymap.description;
				keymapPills.push(pill);

				const labelSpan = append(pill, $('span'));
				labelSpan.textContent = keymap.label;

				if (keymap.id === this.selectedKeymapId) {
					pill.classList.add('selected');
				}

				this.stepDisposables.add(addDisposableListener(pill, EventType.CLICK, () => {
					this._logAction('selectKeymap', undefined, keymap.id);
					this.selectedKeymapId = keymap.id;

					for (const p of keymapPills) {
						p.classList.remove('selected');
						p.setAttribute('aria-checked', 'false');
					}
					pill.classList.add('selected');
					pill.setAttribute('aria-checked', 'true');
					this.accessibilityService.alert(localize('onboarding.keymap.selected.alert', "{0} keyboard mapping selected", keymap.label));
				}));
			}
			const selectedKeymapIndex = keymapOptions.findIndex(k => k.id === this.selectedKeymapId);
			this._setupRadioGroupNavigation(keymapPills, Math.max(0, selectedKeymapIndex));
		}

	}

	private _renderPersonalizeSubtitle(container: HTMLElement): void {
		clearNode(container);
		const modifier = isMacintosh ? 'Cmd' : 'Ctrl';
		container.append(
			localize('onboarding.personalize.tip.prefix', "Tip: Press "),
			this._createKbd(localize({ key: 'onboarding.personalize.tip.modifier', comment: ['This is a keyboard modifier key, Ctrl on Windows/Linux or Cmd on Mac'] }, "{0}", modifier)),
			'+',
			this._createKbd(localize('onboarding.personalize.tip.shift', "Shift")),
			'+',
			this._createKbd(localize('onboarding.personalize.tip.p', "P")),
			localize('onboarding.personalize.tip.suffix', " to access all VS Code commands."),
		);
	}

	private _createThemeCard(parent: HTMLElement, theme: IOnboardingThemeOption, allCards: HTMLElement[]): void {
		const card = this._registerStepFocusable(append(parent, $('div.onboarding-a-theme-card')));
		allCards.push(card);
		card.setAttribute('role', 'radio');
		card.setAttribute('aria-checked', theme.id === this.selectedThemeId ? 'true' : 'false');
		card.setAttribute('aria-label', theme.label);

		if (theme.id === this.selectedThemeId) {
			card.classList.add('selected');
		}

		// SVG preview image
		const preview = append(card, $('div.onboarding-a-theme-preview'));
		const img = append(preview, $<HTMLImageElement>('img.onboarding-a-theme-preview-img'));
		img.alt = '';
		img.src = FileAccess.asBrowserUri(`vs/workbench/contrib/welcomeOnboarding/browser/media/theme-preview-${theme.id}.svg`).toString(true);

		// Label
		const label = append(card, $('div.onboarding-a-theme-label'));
		label.textContent = theme.label;

		this.stepDisposables.add(addDisposableListener(card, EventType.CLICK, () => {
			this._logAction('selectTheme', undefined, theme.id);
			this._selectTheme(theme);
			for (const c of allCards) {
				c.classList.remove('selected');
				c.setAttribute('aria-checked', 'false');
			}
			card.classList.add('selected');
			card.setAttribute('aria-checked', 'true');
			this.accessibilityService.alert(localize('onboarding.theme.selected.alert', "{0} theme selected", theme.label));
		}));

		this.stepDisposables.add(addDisposableListener(card, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				card.click();
			}
		}));
	}

	// =====================================================================
	// Theme / Keymap helpers
	// =====================================================================

	private async _selectTheme(theme: IOnboardingThemeOption): Promise<void> {
		this.selectedThemeId = theme.id;
		const allThemes = await this.themeService.getColorThemes();
		const match = allThemes.find(t => t.settingsId === theme.themeId);
		if (match) {
			this.themeService.setColorTheme(match.id, ConfigurationTarget.USER);
		}
	}

	private async _applyKeymap(keymapId: string): Promise<void> {
		const keymap = (product.onboardingKeymaps ?? []).find(k => k.id === keymapId);
		if (!keymap?.extensionId) {
			return; // VS Code default, nothing to install
		}

		try {
			const gallery = await this.extensionGalleryService.getExtensions([{ id: keymap.extensionId }], CancellationToken.None);
			if (gallery.length > 0) {
				await this.extensionManagementService.installFromGallery(gallery[0], { context: { [EXTENSION_INSTALL_SKIP_WALKTHROUGH_CONTEXT]: true } });
			}
		} catch {
			this.notificationService.notify({
				severity: Severity.Warning,
				message: localize('onboarding.keymap.installError', "Could not install {0} keymap. You can install it later from Extensions.", keymap.label),
			});
		}
	}

	private _hasOtherEditors(): boolean {
		const keymapOptions = this._detectedEditorIds
			? (product.onboardingKeymaps ?? []).filter(k => this._detectedEditorIds!.has(k.id))
			: [];
		return keymapOptions.some(k => k.id !== 'vscode');
	}

	/**
	 * Checks common install paths for known editors and returns the set of
	 * keymap option IDs whose editors are found on this machine.
	 * Always includes 'vscode' (the default). In web environments or on
	 * unknown platforms, returns only 'vscode'.
	 */
	private async _detectInstalledEditors(): Promise<Set<string>> {
		const detected = new Set<string>(['vscode']);
		const home = this.pathService.userHome({ preferLocal: true });

		interface EditorCheck { id: string; paths: URI[] }
		const checks: EditorCheck[] = [];

		if (isWindows) {
			const localAppData = URI.joinPath(home, 'AppData', 'Local');
			checks.push(
				{ id: 'sublime', paths: [URI.file('C:\\Program Files\\Sublime Text\\sublime_text.exe'), URI.file('C:\\Program Files\\Sublime Text 3\\sublime_text.exe')] },
				{ id: 'intellij', paths: [URI.joinPath(localAppData, 'JetBrains', 'Toolbox')] },
				{ id: 'vim', paths: [URI.joinPath(home, '_vimrc'), URI.joinPath(localAppData, 'nvim', 'init.vim'), URI.joinPath(localAppData, 'nvim', 'init.lua')] },
				{ id: 'eclipse', paths: [URI.file('C:\\Program Files\\Eclipse\\eclipse.exe'), URI.file('C:\\Program Files\\eclipse\\eclipse.exe')] },
				{ id: 'notepadpp', paths: [URI.file('C:\\Program Files\\Notepad++\\notepad++.exe'), URI.file('C:\\Program Files (x86)\\Notepad++\\notepad++.exe')] },
			);
		} else if (isMacintosh) {
			checks.push(
				{ id: 'sublime', paths: [URI.file('/Applications/Sublime Text.app')] },
				{ id: 'intellij', paths: [URI.file('/Applications/IntelliJ IDEA.app'), URI.file('/Applications/IntelliJ IDEA CE.app')] },
				{ id: 'vim', paths: [URI.joinPath(home, '.vimrc'), URI.joinPath(home, '.config', 'nvim', 'init.vim'), URI.joinPath(home, '.config', 'nvim', 'init.lua')] },
				{ id: 'eclipse', paths: [URI.file('/Applications/Eclipse.app'), URI.file('/Applications/Eclipse IDE.app')] },
				{ id: 'notepadpp', paths: [URI.file('/Applications/Notepad++.app')] },
			);
		} else if (isLinux) {
			checks.push(
				{ id: 'sublime', paths: [URI.file('/usr/bin/subl'), URI.file('/opt/sublime_text/sublime_text')] },
				{ id: 'intellij', paths: [URI.joinPath(home, '.local', 'share', 'JetBrains', 'Toolbox'), URI.file('/opt/idea')] },
				{ id: 'vim', paths: [URI.joinPath(home, '.vimrc'), URI.joinPath(home, '.config', 'nvim', 'init.vim'), URI.joinPath(home, '.config', 'nvim', 'init.lua')] },
				{ id: 'eclipse', paths: [URI.file('/usr/bin/eclipse'), URI.file('/opt/eclipse/eclipse'), URI.joinPath(home, 'eclipse', 'eclipse')] },
				{ id: 'notepadpp', paths: [URI.file('/usr/bin/notepadqq'), URI.file('/snap/notepad-plus-plus/current')] },
			);
		}

		await Promise.all(checks.map(async check => {
			for (const path of check.paths) {
				try {
					if (await this.fileService.exists(path)) {
						detected.add(check.id);
						return;
					}
				} catch {
					// Path not accessible — skip
				}
			}
		}));

		return detected;
	}

	// =====================================================================
	// Step: AI Preference
	// =====================================================================

	private _renderAiPreferenceStep(container: HTMLElement): void {
		const wrapper = append(container, $('.onboarding-a-ai-pref'));

		const cards = append(wrapper, $('.onboarding-a-ai-pref-cards'));
		cards.setAttribute('role', 'radiogroup');
		cards.setAttribute('aria-label', localize('onboarding.aiPref.label', "Choose your AI collaboration style"));

		const allCards: HTMLButtonElement[] = [];
		for (const option of ONBOARDING_AI_PREFERENCE_OPTIONS) {
			const card = this._registerStepFocusable(append(cards, $<HTMLButtonElement>('button.onboarding-a-ai-pref-card')));
			card.type = 'button';
			card.dataset.id = option.id;
			card.setAttribute('role', 'radio');
			card.setAttribute('aria-checked', option.id === this.selectedAiMode ? 'true' : 'false');
			allCards.push(card);

			if (option.id === this.selectedAiMode) {
				card.classList.add('selected');
			}

			const iconEl = append(card, $('span.onboarding-a-ai-pref-card-icon'));
			iconEl.setAttribute('aria-hidden', 'true');
			const icon = Codicon[option.icon as keyof typeof Codicon] ?? Codicon.sparkle;
			iconEl.appendChild(renderIcon(icon));

			const titleEl = append(card, $('div.onboarding-a-ai-pref-card-title'));
			titleEl.textContent = option.label;

			const descEl = append(card, $('div.onboarding-a-ai-pref-card-desc'));
			descEl.textContent = option.description;

			this.stepDisposables.add(addDisposableListener(card, EventType.CLICK, () => {
				this._logAction('selectAiMode', undefined, option.id);
				this.selectedAiMode = option.id;
				for (const c of allCards) {
					c.classList.toggle('selected', c.dataset.id === option.id);
					c.setAttribute('aria-checked', c.dataset.id === option.id ? 'true' : 'false');
				}
				this._applyAiPreference(option.id);
				this.accessibilityService.alert(localize('onboarding.aiPref.selected.alert', "{0} selected", option.label));
			}));
		}
		const selectedAiIndex = ONBOARDING_AI_PREFERENCE_OPTIONS.findIndex(o => o.id === this.selectedAiMode);
		this._setupRadioGroupNavigation(allCards, Math.max(0, selectedAiIndex));

		const hint = append(wrapper, $('div.onboarding-a-ai-pref-hint'));
		hint.textContent = localize('onboarding.aiPref.hint', "You can change this anytime in Settings.");
	}

	private _applyAiPreference(mode: AiCollaborationMode): void {
		switch (mode) {
			case AiCollaborationMode.CodeFirst:
				this.configurationService.updateValue('chat.agent.autoFix', false, ConfigurationTarget.USER);
				break;
			case AiCollaborationMode.Balanced:
				this.configurationService.updateValue('chat.agent.autoFix', true, ConfigurationTarget.USER);
				break;
			case AiCollaborationMode.AgentForward:
				this.configurationService.updateValue('chat.agent.autoFix', true, ConfigurationTarget.USER);
				break;
		}
	}

	// =====================================================================
	// Step: Agent Sessions
	// =====================================================================

	private _renderAgentSessionsSubtitle(el: HTMLElement): void {
		clearNode(el);
		const keys = isMacintosh
			? ['\u2318', '\u2303', 'I']  // Cmd+Control+I
			: ['Ctrl', 'Alt', 'I'];
		const shortcut = keys.map(k => this._createKbd(k));
		el.append(localize('onboarding.step.agentSessions.subtitle.before', "Open Chat anytime with "));
		for (let i = 0; i < shortcut.length; i++) {
			if (i > 0) {
				el.append('+');
			}
			el.append(shortcut[i]);
		}
	}

	private _renderAgentSessionsStep(container: HTMLElement): void {
		const wrapper = append(container, $('.onboarding-a-sessions'));

		const features = append(wrapper, $('.onboarding-a-sessions-features'));

		// Group 1: Chat modes — Plan / Agent
		const chatGroup = append(features, $('.onboarding-a-sessions-group'));
		const chatLabel = append(chatGroup, $('div.onboarding-a-sessions-group-label'));
		chatLabel.textContent = localize('onboarding.sessions.group.chat', "Agents made for the task");
		const chatGrid = append(chatGroup, $('.onboarding-a-sessions-grid.onboarding-a-sessions-grid-2'));

		this._createFeatureCard(chatGrid, Codicon.listOrdered,
			localize('onboarding.sessions.planMode', "Plan"),
			localize('onboarding.sessions.planMode.desc', "Produce a structured implementation plan before any code changes, then hand it off to an agent to execute."));

		this._createFeatureCard(chatGrid, Codicon.commentDiscussion,
			localize('onboarding.sessions.agentMode', "Agent"),
			localize('onboarding.sessions.agentMode.desc', "Describe a goal. The agent plans the approach, edits files, runs commands, and self-corrects. You review and approve along the way."));

		// Group 2: ways to customize agents beyond the default Chat experience
		const moreGroup = append(features, $('.onboarding-a-sessions-group'));
		const moreLabel = append(moreGroup, $('div.onboarding-a-sessions-group-label'));
		moreLabel.textContent = localize('onboarding.sessions.group.more', "Agents that work your way");
		const moreGrid = append(moreGroup, $('.onboarding-a-sessions-grid.onboarding-a-sessions-grid-2'));

		this._createFeatureCard(moreGrid, Codicon.settingsGear,
			localize('onboarding.sessions.customize', "Customize Your Agents"),
			localize('onboarding.sessions.customize.desc', "Tailor FlowLeap to your patent project with custom instructions and agents, skills, reusable prompts, and MCP servers that connect to the tools and context you rely on."));
	}

	private _createFeatureCard(parent: HTMLElement, icon: ThemeIcon, title: string, description?: string): HTMLElement {
		const card = append(parent, $('div.onboarding-a-feature-card'));
		const iconCol = append(card, $('div.onboarding-a-feature-icon'));
		iconCol.appendChild(renderIcon(icon));
		const textCol = append(card, $('div.onboarding-a-feature-text'));
		const titleEl = append(textCol, $('div.onboarding-a-feature-title'));
		titleEl.textContent = title;
		const descEl = append(textCol, $('div.onboarding-a-feature-desc'));
		if (description) {
			descEl.textContent = description;
		}
		return descEl;
	}

	private _createKbd(label: string): HTMLElement {
		const kbd = $('kbd.onboarding-a-kbd');
		kbd.textContent = label;
		return kbd;
	}

	// =====================================================================
	// Step: Trial (only reachable when signed in)
	// =====================================================================

	private _renderTrialStep(container: HTMLElement): void {
		const wrapper = append(container, $('.onboarding-a-trial'));

		const points = append(wrapper, $('ul.onboarding-a-trial-points'));
		for (const text of [
			localize('onboarding.trial.point.data', "7 days of full patent data on FlowLeap's credentials — no key setup."),
			localize('onboarding.trial.point.card', "Payment method required. Cancel anytime."),
		]) {
			const li = append(points, $('li.onboarding-a-trial-point'));
			const icon = append(li, $('span.onboarding-a-trial-point-icon'));
			icon.setAttribute('aria-hidden', 'true');
			icon.appendChild(renderIcon(Codicon.check));
			const label = append(li, $('span'));
			label.textContent = text;
		}

		const actions = append(wrapper, $('.onboarding-a-trial-actions'));
		const startBtn = this._registerStepFocusable(append(actions, $<HTMLButtonElement>('button.onboarding-a-btn.onboarding-a-btn-primary.onboarding-a-trial-start')));
		startBtn.type = 'button';
		startBtn.textContent = localize('onboarding.trial.start', "Start free trial");

		const status = append(wrapper, $('.onboarding-a-trial-status'));
		status.setAttribute('role', 'status');
		status.setAttribute('aria-live', 'polite');

		this.stepDisposables.add(addDisposableListener(startBtn, EventType.CLICK, () => {
			void this._handleStartTrial(status);
		}));

		// Stop polling whenever this step is torn down (navigation away, dispose).
		this.stepDisposables.add({ dispose: () => this._stopTrialPoll() });
	}

	/**
	 * Open the trial checkout in the browser and begin polling the subscription. The wizard
	 * auto-advances the moment the backend reports access (issue #79 flow, step 4), so returning
	 * from the browser feels seamless. Reuses the extension seam via the `flowleap.startTrial`
	 * command, mirroring the reactive `402` "Start free trial" path.
	 */
	private async _handleStartTrial(status: HTMLElement): Promise<void> {
		this._logAction('trial_started', OnboardingStepId.Trial);
		try {
			await this.commandService.executeCommand('flowleap.startTrial');
		} catch {
			// The command lives in the copilot extension; if it isn't registered yet, surface an
			// inline hint rather than a hidden toast (the modal dims toasts).
			status.textContent = localize('onboarding.trial.openError', "Couldn't open checkout. Please try again.");
			return;
		}
		status.textContent = localize('onboarding.trial.waiting', "Waiting for checkout to complete in your browser…");
		this._startTrialPoll(status);
	}

	private _startTrialPoll(status: HTMLElement): void {
		this._stopTrialPoll();
		const token = ++this._trialPollToken;
		const startedAt = Date.now();
		const win = getActiveWindow();

		const tick = async () => {
			this._trialPollHandle = undefined;

			let access: SubscriptionAccess = 'unknown';
			try {
				access = await this.commandService.executeCommand<SubscriptionAccess>('flowleap.checkSubscription') ?? 'unknown';
			} catch {
				access = 'unknown';
			}

			// A newer poll started, or the poll was stopped, while this check was in flight.
			if (token !== this._trialPollToken) {
				return;
			}

			const decision = decideTrialPoll(access, Date.now() - startedAt);
			if (decision === 'advance') {
				this._stopTrialPoll();
				this._logAction('trial_confirmed', OnboardingStepId.Trial);
				this.accessibilityService.alert(localize('onboarding.trial.confirmed.alert', "Trial active. Continuing."));
				this._nextStep();
			} else if (decision === 'timeout') {
				this._stopTrialPoll();
				if (status.isConnected) {
					status.textContent = localize('onboarding.trial.timeout', "Finish checkout in your browser, then choose Continue.");
				}
			} else {
				this._trialPollHandle = win.setTimeout(tick, TRIAL_POLL_INTERVAL_MS);
			}
		};

		this._trialPollHandle = win.setTimeout(tick, TRIAL_POLL_INTERVAL_MS);
	}

	private _stopTrialPoll(): void {
		// Bump the token so any in-flight tick's post-await result is ignored.
		this._trialPollToken++;
		if (this._trialPollHandle !== undefined) {
			getActiveWindow().clearTimeout(this._trialPollHandle);
			this._trialPollHandle = undefined;
		}
	}

	// =====================================================================
	// Step: Model (connect a BYO AI model)
	// =====================================================================

	private _renderModelStep(container: HTMLElement): void {
		const wrapper = append(container, $('.onboarding-a-model'));

		const rec = append(wrapper, $('.onboarding-a-model-rec'));
		const recTitle = append(rec, $('div.onboarding-a-model-rec-title'));
		recTitle.textContent = localize('onboarding.model.rec.title', "OpenRouter is the easy path");
		const recBody = append(rec, $('div.onboarding-a-model-rec-body'));
		recBody.textContent = localize('onboarding.model.rec.body', "One key connects every model. A typical patent session costs cents. Already have an Anthropic, OpenAI, or Gemini key? You can pick that instead.");

		const actions = append(wrapper, $('.onboarding-a-model-actions'));
		const connectBtn = this._registerStepFocusable(append(actions, $<HTMLButtonElement>('button.onboarding-a-btn.onboarding-a-btn-primary.onboarding-a-model-connect')));
		connectBtn.type = 'button';
		connectBtn.textContent = localize('onboarding.model.connect', "Connect your AI model");

		const status = append(wrapper, $('.onboarding-a-model-status'));
		status.setAttribute('role', 'status');
		status.setAttribute('aria-live', 'polite');

		const skip = this._registerStepFocusable(append(wrapper, $<HTMLButtonElement>('button.onboarding-a-model-skip')));
		skip.type = 'button';
		skip.textContent = localize('onboarding.model.later', "I'll do this later");

		this.stepDisposables.add(addDisposableListener(connectBtn, EventType.CLICK, async () => {
			this._logAction('model_connect', OnboardingStepId.Model);
			try {
				await this.commandService.executeCommand('workbench.action.chat.manage');
			} catch {
				// Manage UI unavailable — leave the status as-is; the user can retry.
			}
			await this._refreshModelState(status, connectBtn);
		}));

		this.stepDisposables.add(addDisposableListener(skip, EventType.CLICK, () => {
			this._logAction('model_skipped', OnboardingStepId.Model);
			// Model is the final P1 step, so skipping still completes the wizard.
			this._dismiss('complete');
		}));

		void this._refreshModelState(status, connectBtn);
	}

	/**
	 * Reflect whether a BYO model is already connected, detected the same way the Setup tree does
	 * (`vscode.lm.selectChatModels` minus the agent pseudo-vendors) via the `flowleap.checkModelConfigured`
	 * command seam. Fires `model_key_added` once when a model is present.
	 */
	private async _refreshModelState(status: HTMLElement, connectBtn: HTMLButtonElement): Promise<void> {
		let configured = false;
		try {
			configured = await this.commandService.executeCommand<boolean>('flowleap.checkModelConfigured') === true;
		} catch {
			configured = false;
		}
		if (!status.isConnected) {
			return;
		}
		if (configured) {
			if (!this._modelKeyAddedLogged) {
				this._modelKeyAddedLogged = true;
				this._logAction('model_key_added', OnboardingStepId.Model);
			}
			status.textContent = localize('onboarding.model.connected', "A model is connected. You're ready to go.");
			connectBtn.textContent = localize('onboarding.model.manage', "Manage models");
		} else {
			status.textContent = '';
		}
	}

	// =====================================================================
	// Radio-group keyboard navigation (roving tabindex)
	// =====================================================================

	/**
	 * Sets up WAI-ARIA radio-group keyboard navigation on a set of elements:
	 * - Arrow keys move focus between items (with wrap-around)
	 * - Only the focused item has tabindex=0; the rest have tabindex=-1
	 * - Space/Enter on a focused item fires its click handler
	 */
	private _setupRadioGroupNavigation(items: HTMLElement[], selectedIndex: number): void {
		// Initialise roving tabindex: only the selected item is tab-reachable
		for (let i = 0; i < items.length; i++) {
			items[i].setAttribute('tabindex', i === selectedIndex ? '0' : '-1');
		}

		for (let i = 0; i < items.length; i++) {
			this.stepDisposables.add(addDisposableListener(items[i], EventType.KEY_DOWN, (e: KeyboardEvent) => {
				const event = new StandardKeyboardEvent(e);
				let newIndex: number | undefined;

				if (event.keyCode === KeyCode.RightArrow || event.keyCode === KeyCode.DownArrow) {
					newIndex = (i + 1) % items.length;
				} else if (event.keyCode === KeyCode.LeftArrow || event.keyCode === KeyCode.UpArrow) {
					newIndex = (i - 1 + items.length) % items.length;
				} else if (event.keyCode === KeyCode.Home) {
					newIndex = 0;
				} else if (event.keyCode === KeyCode.End) {
					newIndex = items.length - 1;
				}

				if (newIndex !== undefined) {
					e.preventDefault();
					e.stopPropagation();
					items[i].setAttribute('tabindex', '-1');
					items[newIndex].setAttribute('tabindex', '0');
					items[newIndex].focus();
					items[newIndex].click();
				}
			}));
		}
	}

	// =====================================================================
	// Focus trap
	// =====================================================================

	private _trapTab(e: KeyboardEvent, shiftKey: boolean): void {
		if (!this.overlay) {
			return;
		}

		const allFocusable = this._getFocusableElements();

		if (allFocusable.length === 0) {
			e.preventDefault();
			return;
		}

		const first = allFocusable[0];
		const last = allFocusable[allFocusable.length - 1];

		if (shiftKey && getActiveWindow().document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!shiftKey && getActiveWindow().document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}

	private _getFocusableElements(): HTMLElement[] {
		return [...(this.closeButton ? [this.closeButton] : []), ...this.stepFocusableElements, ...this.footerFocusableElements].filter(element => this._isTabbable(element));
	}

	private _focusCurrentStepElement(): void {
		const stepFocusable = this.stepFocusableElements.find(element => this._isTabbable(element));
		(stepFocusable ?? this.nextButton ?? this.closeButton)?.focus();
	}

	private _registerStepFocusable<T extends HTMLElement>(element: T): T {
		this.stepFocusableElements.push(element);
		return element;
	}

	private _isTabbable(element: HTMLElement): boolean {
		if (!element.isConnected || element.getAttribute('aria-hidden') === 'true' || element.tabIndex === -1 || element.hasAttribute('disabled')) {
			return false;
		}

		const computedStyle = getActiveWindow().getComputedStyle(element);
		return computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden';
	}

	// =====================================================================
	// Telemetry
	// =====================================================================

	private _logStepView(): void {
		const stepId = this.steps[this.currentStepIndex];
		this.telemetryService.publicLog2<OnboardingStepViewEvent, OnboardingStepViewClassification>('welcomeOnboarding.stepView', {
			step: stepId,
			stepNumber: this.currentStepIndex + 1,
		});
	}

	private _logAction(action: string, stepOverride?: OnboardingStepId, argument?: string): void {
		this.telemetryService.publicLog2<OnboardingActionEvent, OnboardingActionClassification>('welcomeOnboarding.actionExecuted', {
			action,
			step: stepOverride ?? this.steps[this.currentStepIndex],
			argument: argument ?? undefined,
		});
	}

	// =====================================================================
	// Cleanup
	// =====================================================================

	private _removeFromDOM(): void {
		this._stopTrialPoll();

		if (this._signInInFlight) {
			// Don't leave the provider's deep-link wait dangling when the modal is torn down mid-attempt.
			this.commandService.executeCommand('patent-ai.cancelSignIn').then(undefined, () => { });
			this._signInInFlight = false;
		}

		if (this.overlay) {
			this.overlay.remove();
			this.overlay = undefined;
		}

		this.card = undefined;
		this.bodyEl = undefined;
		this.progressContainer = undefined;
		this.stepLabelEl = undefined;
		this.titleEl = undefined;
		this.subtitleEl = undefined;
		this.contentEl = undefined;
		this.backButton = undefined;
		this.nextButton = undefined;
		this.closeButton = undefined;
		this.footerLeft = undefined;
		this._footerSignInBtn = undefined;
		this.footerFocusableElements.length = 0;
		this.stepFocusableElements.length = 0;
		this._signInError = undefined;
		this._isShowing = false;
		this.disposables.clear();
		this.stepDisposables.clear();

		if (this.previouslyFocusedElement) {
			this.previouslyFocusedElement.focus();
			this.previouslyFocusedElement = undefined;
		}

		this.currentStepIndex = 0;
	}

	override dispose(): void {
		this._removeFromDOM();
		super.dispose();
	}
}
