/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../base/common/uri.js';
import { localChatSessionType } from '../../../common/chatSessionsService.js';
import { ChatAgentLocation, ChatModeKind } from '../../../common/constants.js';
import { COPILOT_VENDOR_ID, ILanguageModelChatMetadata, ILanguageModelChatMetadataAndIdentifier, isLanguageModelVendorAbsenceConclusive } from '../../../common/languageModels.js';
import { getChatSessionType, isUntitledChatSession } from '../../../common/model/chatUri.js';

/**
 * Describes the context needed for model selection decisions.
 */
interface IModelSelectionContext {
	readonly location: ChatAgentLocation;
	readonly currentModeKind: ChatModeKind;
	readonly sessionType: string | undefined;
}

/**
 * Filter models based on session type.
 * When a session has a specific type (and it's not 'local'), only models targeting that
 * session type are returned. Otherwise, general-purpose models are returned.
 *
 * `isUserSelectable` defaults to `true` when omitted: only an explicit `false` hides
 * the model from the picker and this model-selection flow.
 */
export function filterModelsForSession(
	models: ILanguageModelChatMetadataAndIdentifier[],
	sessionType: string | undefined,
	currentModeKind: ChatModeKind,
	location: ChatAgentLocation,
): ILanguageModelChatMetadataAndIdentifier[] {
	if (sessionType && sessionType !== 'local' && hasModelsTargetingSession(models, sessionType)) {
		return models.filter(entry =>
			entry.metadata?.targetChatSessionType === sessionType &&
			entry.metadata?.isUserSelectable !== false
		);
	}

	return models.filter(entry =>
		!entry.metadata?.targetChatSessionType &&
		entry.metadata?.isUserSelectable !== false &&
		isModelSupportedForMode(entry, currentModeKind) &&
		isModelSupportedForInlineChat(entry, location)
	);
}

/**
 * Check if a model is suitable for the current chat mode (e.g., agent mode requires tool calling).
 */
export function isModelSupportedForMode(
	model: ILanguageModelChatMetadataAndIdentifier,
	currentModeKind: ChatModeKind,
): boolean {
	if (currentModeKind === ChatModeKind.Agent) {
		return ILanguageModelChatMetadata.suitableForAgentMode(model.metadata);
	}
	return true;
}

/**
 * Check if a model is suitable for inline chat (editor inline) usage.
 */
export function isModelSupportedForInlineChat(
	model: ILanguageModelChatMetadataAndIdentifier,
	location: ChatAgentLocation,
): boolean {
	if (location !== ChatAgentLocation.EditorInline) {
		return true;
	}
	return !!model.metadata.capabilities?.toolCalling;
}

/**
 * Check if any models in the pool target a specific session type.
 */
export function hasModelsTargetingSession(
	allModels: ILanguageModelChatMetadataAndIdentifier[],
	sessionType: string | undefined,
): boolean {
	if (!sessionType) {
		return false;
	}
	return allModels.some(m => m.metadata.targetChatSessionType === sessionType);
}

/**
 * Check if a model is valid for the current session's model pool.
 * If the session has targeted models, the model must target that session type.
 * If no models target this session, the model must not be session-specific.
 */
export function isModelValidForSession(
	model: ILanguageModelChatMetadataAndIdentifier,
	allModels: ILanguageModelChatMetadataAndIdentifier[],
	sessionType: string | undefined,
): boolean {
	if (hasModelsTargetingSession(allModels, sessionType)) {
		return model.metadata.targetChatSessionType === sessionType;
	}
	return !model.metadata.targetChatSessionType;
}

/**
 * Find a model in `pool` that matches `previous` by id, then family, then
 * name (case-insensitive). Used to carry a selection across model pools
 * (e.g. `copilot/claude-sonnet-4.6` → `agent-host-copilotcli:claude-sonnet-4.6`).
 * Returns `undefined` when no candidate matches.
 */
export function findBestMatchingModel(
	previous: ILanguageModelChatMetadataAndIdentifier | undefined,
	pool: readonly ILanguageModelChatMetadataAndIdentifier[],
): ILanguageModelChatMetadataAndIdentifier | undefined {
	if (!previous || pool.length === 0) {
		return undefined;
	}
	const id = previous.metadata.id?.trim().toLowerCase();
	const family = previous.metadata.family?.trim().toLowerCase();
	const name = previous.metadata.name?.trim().toLowerCase();
	return (id ? pool.find(m => m.metadata.id?.trim().toLowerCase() === id) : undefined)
		?? (family ? pool.find(m => m.metadata.family?.trim().toLowerCase() === family) : undefined)
		?? (name ? pool.find(m => m.metadata.name?.trim().toLowerCase() === name) : undefined);
}

/**
 * Find the default model for a given location from a list of models.
 * Prefers the model marked as default for the location, falls back to the first model.
 */
export function findDefaultModel(
	models: ILanguageModelChatMetadataAndIdentifier[],
	location: ChatAgentLocation,
): ILanguageModelChatMetadataAndIdentifier | undefined {
	return models.find(m => m.metadata.isDefaultForLocation[location]) || models[0];
}

/**
 * The model family recommended as the default for a fresh chat when the user has
 * not configured or explicitly picked a model. Matches the tier the agents window
 * resolves to (the newest Sonnet), which measurably outperforms the weaker tiers
 * that alphabetical fallback ordering would otherwise select.
 */
const RECOMMENDED_DEFAULT_MODEL_FAMILY = 'sonnet';

function matchesRecommendedFamily(metadata: ILanguageModelChatMetadata): boolean {
	const haystack = `${metadata.family ?? ''} ${metadata.id ?? ''} ${metadata.name ?? ''}`.toLowerCase();
	return haystack.includes(RECOMMENDED_DEFAULT_MODEL_FAMILY);
}

/**
 * Pick the recommended default model from a pool for a user who has neither
 * configured nor explicitly selected one. Prefers the newest model in the
 * {@link RECOMMENDED_DEFAULT_MODEL_FAMILY} tier — deliberately Sonnet rather than
 * a pricier tier, since under BYOK the user pays per token.
 *
 * BYOK models report a uniform `version` and set `family` to the raw (often dated)
 * model id, so the concrete generation is only legible from the display name / id
 * (e.g. "Claude Sonnet 4.6"); {@link compareModelVersions} on the name selects the
 * newest. Returns `undefined` when the pool has no such model, letting the caller
 * fall back to its normal location default.
 */
export function findRecommendedDefaultModel(
	models: ILanguageModelChatMetadataAndIdentifier[],
): ILanguageModelChatMetadataAndIdentifier | undefined {
	const candidates = models.filter(m => matchesRecommendedFamily(m.metadata));
	if (candidates.length === 0) {
		return undefined;
	}
	return candidates.reduce((best, candidate) =>
		compareModelVersions(candidate.metadata.name, best.metadata.name) > 0 ? candidate : best
	);
}

/**
 * Whether the input should treat a session as a brand-new conversation, which is what unlocks the
 * shared new-chat draft, the default mode/permission level, and `chat.defaultModel`.
 *
 * `hasNoRequests` is sampled when the input binds, and a contributed session's requests load after
 * that — so on its own it reports a started contributed session as new. A contributed session's
 * resource keeps its `untitled-` path until the session is started, so it stays accurate
 * regardless of load timing. Local sessions have no such marker and rely on `hasNoRequests`.
 */
export function isNewConversation(sessionResource: URI, hasNoRequests: boolean): boolean {
	return hasNoRequests
		&& (getChatSessionType(sessionResource) === localChatSessionType || isUntitledChatSession(sessionResource));
}

/**
 * The outcome of looking a requested model identifier up in the current catalog. `pending` means
 * the model is absent but its vendor may still contribute it, so a caller waiting on the model
 * must keep waiting; `unavailable` means the absence is final and the caller may fall back.
 */
export type ModelIdentifierResolution =
	| { readonly kind: 'notRequested' }
	| { readonly kind: 'pending'; readonly identifier: string }
	| { readonly kind: 'available'; readonly model: ILanguageModelChatMetadataAndIdentifier }
	| { readonly kind: 'unavailable'; readonly identifier: string };

/** Reports how far along each vendor's catalog is. */
export interface IModelVendorResolution {
	hasLiveModels(vendor: string): boolean;
	hasResolved(vendor: string): boolean;
}

/** Resolves a requested model identifier against the current model catalog. */
export function resolveModelIdentifier(
	models: readonly ILanguageModelChatMetadataAndIdentifier[],
	identifier: string | undefined,
	isAbsenceConclusive: boolean,
): ModelIdentifierResolution {
	if (!identifier) {
		return { kind: 'notRequested' };
	}

	const model = models.find(model => model.identifier === identifier);
	if (model) {
		return { kind: 'available', model };
	}

	return isAbsenceConclusive
		? { kind: 'unavailable', identifier }
		: { kind: 'pending', identifier };
}

/**
 * Resolves a model identifier using vendor-level catalog readiness. Model identifiers are
 * `<vendor><separator><id>`, so the vendor can be read off an identifier whose model has not been
 * contributed yet — which is the whole point: it lets a remembered selection stay `pending` while
 * its provider is still fetching, instead of being discarded on the first catalog batch.
 */
export function resolveModelIdentifierFromCatalog(
	models: readonly ILanguageModelChatMetadataAndIdentifier[],
	identifier: string | undefined,
	vendorResolution: IModelVendorResolution,
): ModelIdentifierResolution {
	if (!identifier) {
		return { kind: 'notRequested' };
	}

	const separator = identifier.search(/[/:]/);
	const vendor = separator === -1 ? undefined : identifier.substring(0, separator);
	const isAbsenceConclusive = !vendor || isLanguageModelVendorAbsenceConclusive(
		vendor,
		vendorResolution.hasLiveModels(vendor),
		vendorResolution.hasResolved(vendor),
	);
	return resolveModelIdentifier(models, identifier, isAbsenceConclusive);
}

/**
 * Determine whether a persisted model selection should be restored.
 *
 * A persisted model should be restored if:
 * 1. The model still exists in the available models list
 * 2. Either the model wasn't the default at the time it was persisted,
 *    OR it is currently the default for the location
 *
 * This prevents scenarios where a user's explicit model choice gets overridden
 * when the default model changes, while still tracking default model changes
 * for users who never explicitly chose a model.
 */
export function shouldRestorePersistedModel(
	persistedModelId: string,
	persistedAsDefault: boolean,
	availableModels: ILanguageModelChatMetadataAndIdentifier[],
	location: ChatAgentLocation,
): { shouldRestore: boolean; model: ILanguageModelChatMetadataAndIdentifier | undefined } {
	const model = availableModels.find(m => m.identifier === persistedModelId);
	if (!model) {
		return { shouldRestore: false, model: undefined };
	}

	if (!persistedAsDefault || model.metadata.isDefaultForLocation[location]) {
		return { shouldRestore: true, model };
	}

	return { shouldRestore: false, model };
}

/**
 * Determines whether the current model should be reset because it is no longer
 * compatible with the current mode, session, or availability.
 *
 * Returns true if the model should be reset to default.
 */
export function shouldResetModelToDefault(
	currentModel: ILanguageModelChatMetadataAndIdentifier | undefined,
	availableModels: ILanguageModelChatMetadataAndIdentifier[],
	context: IModelSelectionContext,
	allModels: ILanguageModelChatMetadataAndIdentifier[],
): boolean {
	if (!currentModel) {
		return true;
	}

	// Model is no longer in the available list
	if (!availableModels.some(m => m.identifier === currentModel.identifier)) {
		return true;
	}

	// Model not supported for current mode
	if (!isModelSupportedForMode(currentModel, context.currentModeKind)) {
		return true;
	}

	// Model not supported for inline chat
	if (!isModelSupportedForInlineChat(currentModel, context.location)) {
		return true;
	}

	// Model not valid for current session
	if (!isModelValidForSession(currentModel, allModels, context.sessionType)) {
		return true;
	}

	return false;
}

/**
 * Determines whether a model from a sync state should be applied to the current view.
 *
 * Returns an action:
 * - `'keep'`    - the view already has the same model; no change needed.
 * - `'apply'`   - the state model is valid; the caller should switch to it.
 * - `'default'` - the state model is incompatible (wrong session pool, unsupported
 *                 mode, or missing inline-chat capability); the caller should fall
 *                 back to the default model for the current location.
 *
 * @param context Optional because some callers (e.g. unit tests, or code paths
 *   that only care about session-pool validation) don't have a full UI context
 *   available. When omitted, mode and inline-chat checks are skipped and only
 *   session-pool membership is validated.
 */
export function resolveModelFromSyncState(
	stateModel: ILanguageModelChatMetadataAndIdentifier,
	currentModel: ILanguageModelChatMetadataAndIdentifier | undefined,
	allModels: ILanguageModelChatMetadataAndIdentifier[],
	sessionType: string | undefined,
	context?: IModelSelectionContext,
): { action: 'keep' | 'apply' | 'default' } {
	// Validate the state model belongs to this session's model pool first.
	if (!isModelValidForSession(stateModel, allModels, sessionType)) {
		return { action: 'default' };
	}

	// Already the same model and valid for the new pool — nothing to do
	if (currentModel && currentModel.identifier === stateModel.identifier) {
		return { action: 'keep' };
	}

	// When a UI context is available, also validate mode and inline-chat compatibility
	if (context) {
		if (!isModelSupportedForMode(stateModel, context.currentModeKind)) {
			return { action: 'default' };
		}
		if (!isModelSupportedForInlineChat(stateModel, context.location)) {
			return { action: 'default' };
		}
	}

	return { action: 'apply' };
}

/**
 * Merges live models with cached models per-vendor, evicting cache for vendors no longer contributed.
 *
 * - `resolvedVendors`: vendors that have finished resolving. An empty live list for these is authoritative
 *   (e.g. BYOK key removed), so their cache is dropped.
 * - Copilot is the exception: its models are gated on an async token that can resolve slower than fast/local BYOK
 *   providers, so an early empty resolution is transient. Keeping its cache avoids resetting (and persisting) a
 *   restored Copilot selection to a BYOK default, which also preserves the selection across sign-out/in (see #321037).
 * - When nothing is contributed yet and there are no live models (startup / reload), the full cache is returned to
 *   avoid flickering the picker to empty.
 */
export function mergeModelsWithCache(
	liveModels: ILanguageModelChatMetadataAndIdentifier[],
	cachedModels: ILanguageModelChatMetadataAndIdentifier[],
	contributedVendors: Set<string>,
	resolvedVendors?: ReadonlySet<string>,
): ILanguageModelChatMetadataAndIdentifier[] {
	if (contributedVendors.size === 0 && liveModels.length === 0) {
		return cachedModels;
	}
	const liveVendors = new Set(liveModels.map(m => m.metadata.vendor));
	const usableCached = cachedModels.filter(m => {
		const vendor = m.metadata.vendor;
		if (!contributedVendors.has(vendor) || liveVendors.has(vendor)) {
			return false;
		}
		// A resolved vendor with no live models is authoritatively empty and its cache is dropped — except Copilot, whose
		// empty resolution is transient while its token is still pending (see doc comment above).
		if (resolvedVendors?.has(vendor) && vendor !== COPILOT_VENDOR_ID) {
			return false;
		}
		return true;
	});
	return [...liveModels, ...usableCached];
}

/**
 * Determines whether the currently selected model should be reset to default
 * when the language model list changes.
 *
 * Returns true if the model should be reset to default (i.e., the selected model
 * is no longer in the available models list).
 */
export function shouldResetOnModelListChange(
	currentModelId: string | undefined,
	availableModels: ILanguageModelChatMetadataAndIdentifier[],
): boolean {
	if (!currentModelId) {
		return true;
	}
	return !availableModels.some(m => m.identifier === currentModelId);
}

/**
 * Determines whether a late-arriving persisted model should be restored.
 * This handles the startup race where the model wasn't available during
 * `initSelectedModel` but arrives later via `onDidChangeLanguageModels`.
 *
 * The model must pass both the persisted-default check and the user-selectable
 * check. `isUserSelectable` defaults to `true`; only an explicit `false` blocks
 * restoration.
 */
export function shouldRestoreLateArrivingModel(
	persistedModelId: string,
	persistedAsDefault: boolean,
	model: ILanguageModelChatMetadataAndIdentifier,
	location: ChatAgentLocation,
): boolean {
	if (model.metadata.isUserSelectable === false) {
		return false;
	}
	const result = shouldRestorePersistedModel(
		persistedModelId,
		persistedAsDefault,
		[model],
		location,
	);
	return result.shouldRestore;
}

/**
 * The synthetic "Auto" model id. A configured default of `auto` resolves to the
 * model contributed with this id (automatic model selection).
 */
const AUTO_MODEL_ID = 'auto';

/**
 * Compare two model version strings by their numeric segments (e.g. `4.6` > `4.5`,
 * `5.10` > `5.9`). Non-numeric characters are ignored for the numeric comparison;
 * the raw strings break ties for stability. A missing version sorts before any
 * present one. Returns a negative number when `a` sorts before `b`, positive when
 * after, and `0` when equal.
 */
function compareModelVersions(a: string | undefined, b: string | undefined): number {
	const rawA = a ?? '';
	const rawB = b ?? '';
	const segmentsA = rawA.match(/\d+/g)?.map(Number) ?? [];
	const segmentsB = rawB.match(/\d+/g)?.map(Number) ?? [];
	const length = Math.max(segmentsA.length, segmentsB.length);
	for (let i = 0; i < length; i++) {
		const numA = segmentsA[i] ?? 0;
		const numB = segmentsB[i] ?? 0;
		if (numA !== numB) {
			return numA - numB;
		}
	}
	return rawA.localeCompare(rawB);
}

/**
 * Resolve a configured default-model value to a concrete model from the given pool.
 *
 * The configured value (e.g. from `chat.defaultModel`, which may be set
 * by enterprise policy) is matched case-insensitively in this order:
 * 1. `auto` — the synthetic "Auto" model (id `auto`), when present.
 * 2. A full model id — an exact match on `metadata.id`.
 * 3. A model family name (e.g. `opus`, `gemini`) — the model with the highest
 *    {@link compareModelVersions version} among models whose `metadata.family` matches.
 *
 * Returns `undefined` when the value is empty or no model matches, letting the caller
 * fall back to its normal default selection.
 */
export function resolveConfiguredModel(
	configuredValue: string | undefined,
	models: ILanguageModelChatMetadataAndIdentifier[],
): ILanguageModelChatMetadataAndIdentifier | undefined {
	const value = configuredValue?.trim().toLowerCase();
	if (!value) {
		return undefined;
	}

	if (value === AUTO_MODEL_ID) {
		return models.find(m => m.metadata.id?.trim().toLowerCase() === AUTO_MODEL_ID);
	}

	const byId = models.find(m => m.metadata.id?.trim().toLowerCase() === value);
	if (byId) {
		return byId;
	}

	const family = models.filter(m => m.metadata.family?.trim().toLowerCase() === value);
	if (family.length > 0) {
		return family.reduce((latest, candidate) =>
			compareModelVersions(candidate.metadata.version, latest.metadata.version) > 0 ? candidate : latest
		);
	}

	return undefined;
}

/**
 * Why a model picker has no model to offer, when that is the case. Drives a
 * "Pick Model" placeholder plus a contextual action instead of a misleading
 * lone "Auto".
 */
export const enum ModelPickerUnavailableReason {
	/** The workspace is untrusted, which disables the model providers. */
	Restricted = 'restricted',
	/** Chat requires sign-in / setup before any model is available. */
	SetupRequired = 'setupRequired',
}

/**
 * Determines whether a model picker should present an "unavailable" state and,
 * if so, why. Returns `undefined` when the picker has a usable model (or its
 * state is not yet known), so the normal model / Auto label is shown.
 *
 * A model counts as usable only when it is both offered by this picker
 * (`pickerModels`, already filtered to the picker's location / session type) AND
 * currently live in the language model registry (`liveModelIds`). This ignores
 * two kinds of phantom models that would otherwise mask the unavailable state:
 * - stale cross-window machine cache entries (present in `pickerModels` but not live), and
 * - models registered for other surfaces such as agent-host session-scoped models
 *   (live in the global registry but not offered by this picker).
 *
 * A live, picker-offered model (e.g. BYOK) always wins, so BYOK and anonymous
 * access are never shown an unavailable state. `trusted` reflects
 * `isWorkspaceTrusted()` (which is `true` when trust is disabled entirely) and is
 * only authoritative once `trustInitialized` is `true`; until then this returns
 * `undefined` to avoid a trusted workspace briefly rendering as unavailable at
 * startup. Restricted (untrusted) takes precedence over setup-required.
 */
export function getModelPickerUnavailableReason(context: {
	readonly trustInitialized: boolean;
	readonly trusted: boolean;
	readonly pickerModels: readonly ILanguageModelChatMetadataAndIdentifier[];
	readonly liveModelIds: Iterable<string>;
	readonly requiresSetup: boolean;
}): ModelPickerUnavailableReason | undefined {
	if (!context.trustInitialized) {
		return undefined;
	}
	const live = context.liveModelIds instanceof Set ? context.liveModelIds : new Set(context.liveModelIds);
	if (context.pickerModels.some(model => live.has(model.identifier))) {
		return undefined;
	}
	if (!context.trusted) {
		return ModelPickerUnavailableReason.Restricted;
	}
	if (context.requiresSetup) {
		return ModelPickerUnavailableReason.SetupRequired;
	}
	return undefined;
}
