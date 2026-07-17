---
id: H10
title: Default/recommend the stronger main-window model (real-world lever, not a same-model fix)
type: task
status: closed
assignee: abdullahatrash
blocked-by: []
---

## Question

The single largest effect in the whole corpus is the model: swapping only Sonnet 4 → Sonnet 5
on the identical fork stack closed **2 of 2** clean-task gaps and left Sonnet 5 with zero
clean-task losses. The main window shipped defaulting to the weaker model while the agents
window resolves to the stronger one. Should the main window default to (or first-run nudge
toward) the stronger Claude tier, and what does that touch?

### What to change (from [H3 attribution](../assets/H3-attribution.md), fix slice 6)

- Make the recommended/default main-window BYOK model the stronger Claude tier (Sonnet 5),
  matching what the agents window resolves to — or surface a first-run nudge if a hard
  default is wrong under BYOK. Surfaces: model default/config + onboarding copy (BYOK model
  selection).

### Scope caveat (read before picking this up)

This is the **highest-leverage real-world quality lever**, but it does **not** close the
map's destination, which is an explicitly **same-model** win-or-tie head-to-head — changing
the model changes which model the user runs, it doesn't make the *stack* better at a fixed
model. Track it because the evidence for it is the strongest in the corpus and it is the
fastest user-visible win; but H5–H9 are what the same-model gate needs. Do not let this
substitute for them. Coordinate with existing BYOK model-selection UX
(memory `byok-ux-review-issue-map`). One agent session.

## Resolution (2026-07-17)

**Decision: code-level recommended default (not a nudge, not a hard `chat.defaultModel`).**
The main window now recommends the newest Sonnet in its no-explicit-choice fallback path,
matching the tier the agents window resolves to. Explicit user picks are untouched and always
win.

### Why this shape

Investigation of the actual resolution path (main window uses
`chatInputPart.initSelectedModel` → fallback `setCurrentLanguageModelToDefault` →
`findDefaultModel`) surfaced three facts that ruled out the approaches the ticket/H3 floated:

1. **A hard `chat.defaultModel` default would violate "respect the user's pick."** The
   configured-default path (`chatInputPart.ts:939-960`) *overrides a persisted selection on
   every new conversation* by design. Setting it would force the model on users who
   deliberately chose another (incl. a cheaper BYOK model). So the intervention had to live in
   the *fallback* branch, which only fires when the user has neither configured nor picked a
   model — leaving the persisted-restore path (`shouldRestorePersistedModel`) intact.
2. **`resolveConfiguredModel('sonnet', …)` does not work for BYOK.** BYOK models set
   `family = id` (dated/rotating ids like `claude-sonnet-4-5-20250929`, or OpenRouter
   `anthropic/claude-sonnet-4.5`) and a **uniform `version: '1.0.0'`**
   (`byokProvider.ts:146-168`). Family/version-based resolution can neither match "sonnet" nor
   distinguish generations. The only legible generation signal is the display **name/id**
   string.
3. **The current fallback is worse than "Sonnet 4."** `findDefaultModel` returns
   `models[0]` = alphabetically-first by name, which among Claude models is "Claude Haiku …" —
   the *weakest* tier. The reversion class the ticket flagged (picks not sticking → a weaker
   model) lands here.

### What changed (core `src/vs`, no product.json — configurationDefaults are inert on desktop)

- `chatModelSelectionLogic.ts`: added `findRecommendedDefaultModel(models)` + a private
  `RECOMMENDED_DEFAULT_MODEL_FAMILY = 'sonnet'`. It filters the pool to models whose
  name/id/family contains "sonnet", then picks the newest via the existing
  `compareModelVersions` applied to the **display name** (since `version` is uniform). Returns
  `undefined` when no Sonnet is present, so non-Anthropic BYOK setups fall through unchanged.
  Deliberately Sonnet, **not** Opus — under BYOK the user pays per token, and Sonnet→Sonnet is
  the same price tier while Opus would be a pricier silent default.
- `chatInputPart.ts` `setCurrentLanguageModelToDefault`: inserted
  `configuredModel ?? recommendedModel ?? findDefaultModel(...)`. This is the single choke
  point for all 8 fallback call sites (first-run, session reset, model-list change, and the
  reversion edge case), so the recommendation covers every no-choice path.
- Added a `findRecommendedDefaultModel` unit suite (4 cases: newest-Sonnet-beats-Haiku/Opus/older-Sonnet,
  OpenRouter-prefixed name, no-Sonnet → undefined, empty pool → undefined).

### Model-choice-reversion path

Found it, and this fix improves it without over-reaching. In the normal case an explicit pick
**does** stick (`isDefault` flag stored `false` for BYOK → `shouldRestorePersistedModel`
restores it). The reversion only occurs when that flag is read as its missing-key default
`true` (stale/cross-window/cleared storage) → fallback → previously `models[0]` (Haiku). The
fix makes that fallback land on the newest Sonnet instead. It does not alter the persisted
`isDefault` semantics (a broader, riskier change left out of this one-session slice).

### Note on "Sonnet 5"

The fork's BYOK picker has no `claude-sonnet-5` id; its own capability detectors treat
`claude-sonnet-4-6` as the newest Sonnet. The fix targets "newest Sonnet available in the
user's pool" generically rather than a fixed id, so it tracks whatever the strongest Sonnet is
without needing edits as ids rotate.

### Scope caveat (unchanged)

This is a real-world quality lever, **not** a same-model win. It changes which model new chats
start on; it does not make the stack better at a fixed model. H5–H9 remain what the same-model
gate needs.

### Verification

`npx tsgo --noEmit -p ./src/tsconfig.json` → 0 errors (whole client, incl. the new test).
Algorithm validated in isolation against all 4 test cases (out/ build was stale; not run
against it to avoid testing pre-edit output under the shared tree).

### Files changed

- `src/vs/workbench/contrib/chat/browser/widget/input/chatModelSelectionLogic.ts`
- `src/vs/workbench/contrib/chat/browser/widget/input/chatInputPart.ts`
- `src/vs/workbench/contrib/chat/test/browser/widget/input/chatModelSelectionLogic.test.ts`
