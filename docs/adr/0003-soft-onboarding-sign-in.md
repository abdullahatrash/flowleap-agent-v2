# Soft, skippable onboarding sign-in (no hard gate)

**Status:** accepted

The old fork made the first-run onboarding sign-in step a **hard gate**: the modal could not
be dismissed (close / Escape / overlay) and the user could not advance until a FlowLeap Session
existed. That logic lived in a pure `welcomeOnboarding/common/onboardingSignInGate.ts` state
machine (`Idle → Pending → Failed/Canceled → SignedIn`, with a `dismissable` flag) plus a Cancel
control wired to `patent-ai.cancelSignIn`. Issue #21 was originally written to port exactly that.

We **reverse** that decision. The onboarding modal keeps the upstream VS Code chrome and flow —
**X / Back / Continue, Escape, overlay-dismiss, and an explicit "Continue without Signing In"** —
and the sign-in step is just one rebranded FlowLeap step inside it. Sign-in is **not** required to
reach the IDE. We do **not** port `onboardingSignInGate.ts` or its unit test.

The reason is the product shape after the BYOK move (see [0002](0002-consolidate-auth-to-clerk-template-token.md)):
inference is **BYOK** and works with no FlowLeap Session at all; the FlowLeap Session only unlocks
the paid **patent-data backend**, which already fails closed per request (401/402). A hard gate
therefore blocks users from a fully usable BYOK IDE to protect a backend that is already gated
downstream — the wrong trade-off. A soft step nudges sign-in without trapping first-run users.

## Consequences

- The sign-in step drives sign-in through `commandService.executeCommand('flowleap.signIn', { silent: true })`
  (the native `getSession({ createIfNone: true })` path), shows a spinner on the button while in
  flight, and surfaces failures as **inline** text (toasts render hidden under the modal — the
  reason `flowleap.signIn` takes a `silent` flag). There is no inline Cancel; closing the modal
  bails, and the step fires `patent-ai.cancelSignIn` on dispose-while-pending so no deep-link wait
  dangles.
- `onboardingSignInGate.ts` and `onboardingSignInGate.test.ts` are **not** ported. #21's original
  "the pure state-machine unit test passes" acceptance criterion is dropped; sign-in state is a
  simple in-component flag initialized from the read-only `flowleap.signedIn` context key.
- Sign-**out** is not built into onboarding. Once signed in, VS Code's native Accounts menu shows
  "FlowLeap → Sign Out" via the `flowleap` provider's `removeSession` (and `patent-ai.signOut`).
- The GitHub Copilot terms / privacy / public-code disclaimer is removed from the step rather than
  re-pointed, keeping #21 decoupled from the still-open `product.json` wiring (#22). A FlowLeap
  Terms line can be added once `product.json` carries real FlowLeap URLs.
- First-run triggering is unchanged: `welcomeGettingStarted/browser/startupPage.ts` still calls
  `onboardingService.show()` once (gated on `ONBOARDING_STORAGE_KEY`). Two of its other gates are
  inherited risks to verify under FlowLeap — `workbench.welcomePage.experimentalOnboarding` must be
  enabled, and `chatEntitlementService.sentiment.hidden` (GitHub-entitlement-driven, touched by the
  CAPI-disable in #8) must not be `true`, or the modal is silently suppressed.
