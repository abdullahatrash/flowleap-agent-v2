/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { IProductOnboardingTheme } from '../../../../base/common/product.js';

/**
 * Step identifiers for the onboarding walkthrough.
 */
export const enum OnboardingStepId {
	Role = 'onboarding.role',
	SignIn = 'onboarding.signIn',
	Personalize = 'onboarding.personalize',
	AiPreference = 'onboarding.aiPreference',
	AgentSessions = 'onboarding.agentSessions',
	Trial = 'onboarding.trial',
	Model = 'onboarding.model',
}

/**
 * Returns a localized title for each step.
 */
export function getOnboardingStepTitle(stepId: OnboardingStepId): string {
	switch (stepId) {
		case OnboardingStepId.Role:
			return localize('onboarding.step.role', "What brings you to FlowLeap?");
		case OnboardingStepId.SignIn:
			return localize('onboarding.step.signIn', "Sign In");
		case OnboardingStepId.Personalize:
			return localize('onboarding.step.personalize', "Make It Yours");
		case OnboardingStepId.AiPreference:
			return localize('onboarding.step.aiPreference', "Your AI Style");
		case OnboardingStepId.AgentSessions:
			return localize('onboarding.step.agentSessions', "Build with AI Agents");
		case OnboardingStepId.Trial:
			return localize('onboarding.step.trial', "Start Your Trial");
		case OnboardingStepId.Model:
			return localize('onboarding.step.model', "Connect Your AI Model");
	}
}

/**
 * Returns a localized subtitle for each step.
 */
export function getOnboardingStepSubtitle(stepId: OnboardingStepId): string {
	switch (stepId) {
		case OnboardingStepId.Role:
			return localize('onboarding.step.role.subtitle', "This tailors your first investigation and the examples we show you.");
		case OnboardingStepId.SignIn:
			return localize('onboarding.step.signIn.subtitle', "Sync settings, unlock AI features, and connect to GitHub");
		case OnboardingStepId.Personalize:
			return localize('onboarding.step.personalize.subtitle', "Choose your theme and keyboard mapping");
		case OnboardingStepId.AiPreference:
			return localize('onboarding.step.aiPreference.subtitle', "Choose how much AI collaboration fits your workflow");
		case OnboardingStepId.AgentSessions:
			return localize('onboarding.step.agentSessions.subtitle', "Open Chat anytime with {0}", isMacintosh ? '\u2318\u2303I' : 'Ctrl+Alt+I');
		case OnboardingStepId.Trial:
			return localize('onboarding.step.trial.subtitle', "Explore the full patent backend on our credentials \u2014 no key setup required.");
		case OnboardingStepId.Model:
			return localize('onboarding.step.model.subtitle', "FlowLeap runs on your own AI model. One key connects it.");
	}
}

/**
 * Ordered step IDs for the onboarding flow (patent-persona funnel, issue #79).
 *
 * Role \u2192 See it work \u2192 Sign in \u2192 Trial \u2192 Connect a model. The {@link OnboardingStepId.Trial}
 * step is only reachable when signed in; {@link computeVisibleSteps} filters it out otherwise.
 * The legacy {@link OnboardingStepId.Personalize} / {@link OnboardingStepId.AiPreference} steps
 * are intentionally absent \u2014 the theme default is applied silently (issue #79 principle 4).
 */
export const ONBOARDING_STEPS: readonly OnboardingStepId[] = [
	OnboardingStepId.Role,
	OnboardingStepId.AgentSessions,
	OnboardingStepId.SignIn,
	OnboardingStepId.Trial,
	OnboardingStepId.Model,
];

/**
 * Runtime facts that decide which steps are shown.
 */
export interface OnboardingStepContext {
	/** Whether a FlowLeap session currently exists. */
	readonly signedIn: boolean;
}

/**
 * The steps visible for a given runtime {@link OnboardingStepContext}, in {@link ONBOARDING_STEPS}
 * order. The trial step is value-framed on FlowLeap's own credentials, so it only makes sense once
 * signed in; a user who continues without signing in never sees it (issue #79 flow, step 4).
 */
export function computeVisibleSteps(context: OnboardingStepContext): OnboardingStepId[] {
	return ONBOARDING_STEPS.filter(stepId => stepId !== OnboardingStepId.Trial || context.signedIn);
}

/**
 * Persona the user selects on the first (Role) step. Captured and stored in P1; it tailors later
 * copy and the finale investigation in a later phase (issue #79 P2/P3).
 */
export const enum OnboardingRole {
	PatentAttorney = 'patent-attorney',
	IpAnalyst = 'ip-analyst',
	Researcher = 'researcher',
	Founder = 'founder',
}

/**
 * A selectable role card on the Role step.
 */
export interface IOnboardingRoleOption {
	readonly id: OnboardingRole;
	readonly label: string;
	readonly description: string;
	readonly icon: string;
}

/**
 * Role cards shown on the first onboarding step, in display order.
 */
export const ONBOARDING_ROLE_OPTIONS: readonly IOnboardingRoleOption[] = [
	{
		id: OnboardingRole.PatentAttorney,
		label: localize('onboarding.role.attorney', "Patent attorney"),
		description: localize('onboarding.role.attorney.desc', "Draft and prosecute applications, analyze claims, and assess freedom to operate."),
		icon: 'law',
	},
	{
		id: OnboardingRole.IpAnalyst,
		label: localize('onboarding.role.analyst', "IP analyst"),
		description: localize('onboarding.role.analyst.desc', "Map patent landscapes, track competitors, and build portfolio intelligence."),
		icon: 'graph',
	},
	{
		id: OnboardingRole.Researcher,
		label: localize('onboarding.role.researcher', "Researcher"),
		description: localize('onboarding.role.researcher.desc', "Explore prior art across patents and academic literature for your field."),
		icon: 'beaker',
	},
	{
		id: OnboardingRole.Founder,
		label: localize('onboarding.role.founder', "Founder"),
		description: localize('onboarding.role.founder.desc', "Validate an idea, sketch freedom to operate, and shape a patent strategy."),
		icon: 'rocket',
	},
];

/**
 * Tri-state FlowLeap subscription access, mirroring the extension's `getSubscriptionAccess()`
 * bridge: `active` (active or trialing), a confirmed `inactive`, or an `unknown` inconclusive check.
 */
export type SubscriptionAccess = 'active' | 'inactive' | 'unknown';

/** How often the Trial step re-checks the subscription while the user is in the browser checkout. */
export const TRIAL_POLL_INTERVAL_MS = 5_000;

/** How long the Trial step keeps polling before giving up and letting the user advance manually. */
export const TRIAL_POLL_TIMEOUT_MS = 5 * 60 * 1000;

/** The decision the Trial poll loop makes after each subscription check. */
export type TrialPollDecision = 'advance' | 'continue' | 'timeout';

/**
 * Pure decision for one tick of the Trial subscription poll. Advances the wizard the moment access
 * is confirmed (`active`), stops once the {@link TRIAL_POLL_TIMEOUT_MS} budget is spent, and keeps
 * polling otherwise. An `unknown` result (e.g. the check couldn't reach the backend) is treated as
 * "keep waiting" \u2014 the checkout may simply not have completed yet.
 */
export function decideTrialPoll(access: SubscriptionAccess, elapsedMs: number): TrialPollDecision {
	if (access === 'active') {
		return 'advance';
	}
	if (elapsedMs >= TRIAL_POLL_TIMEOUT_MS) {
		return 'timeout';
	}
	return 'continue';
}

/**
 * Theme option for the onboarding personalization step.
 * Sourced from product.json via `onboardingThemes`.
 */
export type IOnboardingThemeOption = IProductOnboardingTheme;

/**
 * AI collaboration preference for the AI style step.
 */
export const enum AiCollaborationMode {
	CodeFirst = 'code-first',
	Balanced = 'balanced',
	AgentForward = 'agent-forward',
}

/**
 * AI collaboration preference option.
 */
export interface IAiPreferenceOption {
	readonly id: AiCollaborationMode;
	readonly label: string;
	readonly description: string;
	readonly icon: string;
}

/**
 * AI collaboration preference options shown in the AI style step.
 */
export const ONBOARDING_AI_PREFERENCE_OPTIONS: readonly IAiPreferenceOption[] = [
	{
		id: AiCollaborationMode.CodeFirst,
		label: localize('onboarding.aiPref.codeFirst', "I Write the Code"),
		description: localize('onboarding.aiPref.codeFirst.desc', "AI assists with suggestions and answers questions when you ask. You stay in control of every edit."),
		icon: 'edit',
	},
	{
		id: AiCollaborationMode.Balanced,
		label: localize('onboarding.aiPref.balanced', "Side by Side"),
		description: localize('onboarding.aiPref.balanced.desc', "Inline suggestions plus a chat panel for deeper collaboration. A balance of writing and delegating."),
		icon: 'layoutSidebarRight',
	},
	{
		id: AiCollaborationMode.AgentForward,
		label: localize('onboarding.aiPref.agentForward', "AI Takes the Lead"),
		description: localize('onboarding.aiPref.agentForward.desc', "Let the agent drive — describe what you want and review the result. Great for scaffolding and exploration."),
		icon: 'copilot',
	},
];

/**
 * Storage key for persisting onboarding completion state.
 */
export const ONBOARDING_STORAGE_KEY = 'welcomeOnboarding.state';

/**
 * Storage key for the persisted role selection ({@link OnboardingRole}). APPLICATION scope, so the
 * choice survives across windows and a wizard re-trigger pre-selects it.
 */
export const ONBOARDING_ROLE_STORAGE_KEY = 'welcomeOnboarding.role';

/**
 * Regex matching a single-word GHE instance slug (e.g. "octocat").
 * Only allows characters valid in DNS hostnames (letters, digits, hyphens).
 */
export const GHE_DOMAIN_REGEX = /^[a-zA-Z0-9-]+$/;

/**
 * Regex matching a full GHE instance URI (e.g. "https://octocat.ghe.com").
 */
export const GHE_FULL_URI_REGEX = /^(https:\/\/)?([a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+\.ghe\.com\/?$/;

export const enum GheParseResultKind {
	Empty = 'empty',
	SingleWord = 'singleWord',
	FullUri = 'fullUri',
	Invalid = 'invalid',
}

export type GheParseResult =
	| { readonly kind: GheParseResultKind.Empty }
	| { readonly kind: GheParseResultKind.SingleWord; readonly resolvedUri: string }
	| { readonly kind: GheParseResultKind.FullUri; readonly resolvedUri: string }
	| { readonly kind: GheParseResultKind.Invalid };

/**
 * Parses a GHE instance input value and returns the result kind and resolved URI.
 */
export function parseGheInstanceInput(value: string): GheParseResult {
	const trimmed = value.trim();
	if (!trimmed) {
		return { kind: GheParseResultKind.Empty };
	}

	if (GHE_DOMAIN_REGEX.test(trimmed)) {
		return { kind: GheParseResultKind.SingleWord, resolvedUri: `https://${trimmed}.ghe.com` };
	}

	if (GHE_FULL_URI_REGEX.test(trimmed)) {
		const resolvedUri = trimmed.toLowerCase().startsWith('https://') ? trimmed : `https://${trimmed}`;
		return { kind: GheParseResultKind.FullUri, resolvedUri };
	}

	return { kind: GheParseResultKind.Invalid };
}
