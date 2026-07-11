# PRD 0008 · UI & product-surface polish: patent-voice chat chrome, Account section, native Projects tree, and a patent-grade PDF reader

Source: 4-agent UI review of 2026-07-11 (workbench/chat design evaluation against three live screenshots, FlowLeap UI Shell projects-surface UX review, pdf-preview review, user-profile/backend evaluation), consolidated in `docs/reviews/2026-07-11-ui-review-findings.md` and grilled with the product owner on the same day. Key file-level claims were spot-verified against the working tree before inclusion. Domain vocabulary (Project Status, Project Type, FlowLeap Settings Sidebar, FlowLeap Session) was ratified into `CONTEXT.md` during the grill.

## Problem Statement

FlowLeap Patent IDE already reads as a patent tool where it matters most — report rendering, the patent project structure, patent-voiced follow-up suggestions, the keys page. But four classes of user-facing debt remain, each small individually and corrosive together:

1. **The chat strip still speaks coding-copilot.** The most-looked-at control in the app — the empty chat input — says "Describe what to build". The status bar shows a code-problems counter (⊗0 ⚠0) that can never matter to a patent analyst, and the chat footer shows a "Local" environment chip that distinguishes nothing because only one environment exists.

2. **Project management is illegible.** The Projects sidebar's three per-project actions are raw emoji (📝, a bare black dot ●, 📦) with single-noun tooltips, visible only on hover — the product owner's literal words: "I don't know what they do." Every new project lands in a group called DRAFT (a loaded word in patent practice that describes documents, not investigations) behind a faded gray dot that reads "disabled". Type labels ("Custom", "Patent") carry no information. There is no rename and no delete. Meanwhile a fully-written native tree provider with correct theme icons and rich tooltips sits dead in the same file, never registered — the right implementation was started and abandoned.

3. **Signed-in users are invisible to themselves.** A paying user can see their subscription status nowhere (the trial pill hides once the trial ends), there is no "manage subscription" affordance anywhere in the IDE even though the backend already serves the Polar customer-portal URL, and the 30-day FlowLeap Session token dies silently — users discover expiry via a random 401. Two identical gear icons in the Activity Bar (FlowLeap Settings and the core Manage gear) compound the confusion.

4. **The PDF reader falls short of patent reading.** Japanese/Chinese/Korean patents — routine in prior-art work — render blank or garbled because character maps are fetched from a CDN the webview's security policy blocks. All pages render up-front at full retina resolution, so a 40-page figure-heavy patent means slow first paint and out-of-memory risk. There is no find-in-document, so a claim term or reference numeral can't be located in a long specification. And the OCR extract silently overwrites files beside the PDF with no confirmation, builds Windows-broken paths, can't be cancelled, and leaks vendor names ("Mistral", "PDF.js") into user-facing strings.

## Solution

One polish-and-correctness pass in four file-disjoint lanes so independent agents can execute concurrently in the shared working tree:

- **Chat chrome**: patent-voice the per-mode input placeholders through the same patent-IDE-mode branch that already overrides the welcome titles; gate the problems counter and the "Local" chip out of patent mode. "Default Approvals", the "CHAT" title, the "Agent" mode label, and the model-picker label ("Anthropic: Claude Sonnet 4 · Medium") stay exactly as they are — owner decision: functional-technical labels are welcome; wrong-domain labels are not.
- **Settings & Account**: add an Account section to the top of the FlowLeap Settings Sidebar (identity, subscription status pill, Manage subscription via the Polar portal, sign-out) rendered entirely from data the auth provider already fetches; add a token-expiry status-bar nudge; resolve the two-gears collision with icons, not names (FlowLeap brand mark for the FlowLeap container, briefcase for Projects); three copy/layout polish items on the keys page.
- **Projects**: ship a one-line tooltip stopgap immediately, then replace the hand-rolled webview with the already-written native tree provider — inline actions and context menus via native menu contributions, the ratified four-status model (Active / In Review / Complete / Archived, default Active) with legacy-status migration, the ratified six-type model (Patent Analysis / Prior-Art Search / Freedom-to-Operate / Patent Landscape / Claim Analysis / Custom), and new rename/delete commands.
- **pdf-preview**: bundle the CJK character maps locally; render pages lazily; add find-in-document over the existing text layer; make OCR extraction safe (confirm-before-overwrite, portable paths, cancellable, vendor-neutral localized strings) plus two micro-fixes (escaped error rendering, dead command branch).

## User Stories

### Chat chrome

1. As a patent attorney opening the chat, I want the empty input to say "Describe a patent research task", so that the product speaks my domain in its most prominent control.
2. As a user in Ask mode, I want the placeholder "Ask about patents, claims, or prior art", so that I know what kind of question belongs here.
3. As a user in Edit mode, I want the placeholder "Describe the document changes to make", so that the mode's purpose is self-evident.
4. As a patent analyst, I want the code-problems counter (⊗0 ⚠0) gone from my status bar, so that the app stops signalling "developer tool" in its chrome.
5. As a user, I want the "Local" environment chip hidden while only one environment exists, so that the chat footer carries no label that distinguishes nothing.
6. As a power user, I want the model picker, "Default Approvals", the "CHAT" panel title, and the "Agent" mode label left exactly as they are, so that functional controls I rely on don't churn.

### Settings & Account

7. As a signed-in user, I want an Account section at the top of FlowLeap Settings showing my name and email, so that I can always see which identity I'm working under.
8. As a trial user, I want the Account section to show "Trial · N days left", so that I know how long I have before deciding.
9. As a paying subscriber, I want the Account section to show "Active" (or "Cancels on {date}" when I've cancelled), so that my subscription state is visible after the trial pill disappears.
10. As a subscriber, I want a "Manage subscription" button that opens my Polar customer portal in the browser, so that I can change billing without hunting through a website.
11. As a signed-out user, I want the Account section to show a single Sign in button, so that the path into the product is obvious.
12. As a signed-in user, I want a small Sign out link in the Account section, so that I can end my session where I'd naturally look for it.
13. As a user whose FlowLeap Session is within 3 days of expiry, I want a status-bar nudge that re-runs sign-in when clicked, so that my session never dies silently into 401s.
14. As a user scanning the Activity Bar, I want the FlowLeap Settings container to carry the FlowLeap brand mark instead of a second gear, so that it can't be confused with the core Manage gear.
15. As a user scanning the Activity Bar, I want the Projects container to carry a briefcase icon instead of a beaker, so that the icon says "case files", not "science experiment".
16. As a non-developer, I want the primary model button to say "Add AI Model" without "(BYOK)", so that I'm not confronted with acronym jargon on a primary action.
17. As a user entering patent-office keys, I want the where-to-get-this-key guidance to persist as captions under the fields instead of vanishing placeholder text, so that the help survives my first click.
18. As a privacy-conscious user, I want the keys-stay-local privacy note positioned to head the two patent-office cards it describes, so that the explanation sits with what it explains.

### Projects

19. As the product owner on today's build, I want the three hover buttons to say "Open Notes", "Change Status", and "Archive Project" on hover, so that the current sidebar stops being cryptic while the rewrite lands.
20. As a user, I want the Projects sidebar to be a native tree with theme-correct icons, so that it looks and behaves like every other part of the IDE.
21. As a user, I want to right-click a project and see every available action with plain labels, so that I never have to guess what an icon does.
22. As a user, I want inline project actions rendered as proper theme icons with action-verb tooltips, so that hover affordances are self-explanatory.
23. As a user creating a project, I want it to start as **Active**, so that my new investigation doesn't land in a group called DRAFT that reads as dormant.
24. As a patent professional, I want project statuses named Active / In Review / Complete / Archived, so that lifecycle words match patent practice (where "draft" describes documents, not investigations).
25. As a returning user with pre-existing projects, I want legacy statuses (draft, in-progress, under-review) mapped automatically onto the new set, so that my project list survives the upgrade untouched.
26. As a user, I want per-row status conveyed by one clear status icon rather than a faded gray dot duplicating the group header, so that my active work never looks disabled.
27. As a user creating a project, I want to choose among Patent Analysis, Prior-Art Search, Freedom-to-Operate, Patent Landscape, Claim Analysis, and Custom, so that the project type speaks the deliverables I actually produce.
28. As a user doing an invalidity search, I want guidance that Patent Analysis is the type for work on a specific granted patent, so that I'm not left hunting for an "Invalidity" type that doesn't exist.
29. As a user, I want each project type to seed an appropriate notes template and show as the row's description, so that the type does real organizational work.
30. As a user, I want to rename a project, so that evolving client matters keep accurate names.
31. As a user, I want to delete a project behind a confirmation prompt, so that abandoned experiments don't clutter my archive forever.
32. As a user, I want the New Project action in the view's title bar where every VS Code view puts it, so that creation is discoverable by convention.
33. As a user, I want project timestamps to carry a tooltip saying what the time refers to, so that "2w" is unambiguous.

### pdf-preview

34. As a prior-art searcher, I want Japanese, Chinese, and Korean patent PDFs to render correctly offline, so that non-Latin prior art is readable — routinely, not exceptionally.
35. As a reader of a 40-page figure-heavy patent, I want pages rendered lazily as I scroll, so that the document opens fast and doesn't exhaust memory.
36. As a reader, I want find-in-document with match highlighting and next/previous navigation, so that I can locate a claim term or reference numeral in a long specification.
37. As a user running OCR extraction, I want a confirmation before any existing file is overwritten, so that a second run can't silently destroy my earlier extraction.
38. As a Windows user, I want OCR output paths built portably, so that extraction works identically across platforms.
39. As a user, I want OCR progress to be cancellable, so that a hung backend doesn't leave the button stuck at "Processing…" forever.
40. As a user, I want extraction strings localized and vendor-neutral, so that the product doesn't leak "Mistral" or "PDF.js" implementation detail at me.
41. As a user, I want PDF error messages rendered as text (not injected markup), so that a strange filename can't break the error card.
42. As a user invoking Extract Text from the command palette with a text editor focused, I want the command to still act on the active PDF tab, so that the command works instead of silently no-oping.

## Implementation Decisions

- **Owner-locked non-goals**: the model-picker label, "Default Approvals", the "CHAT" panel title, and the "Agent" mode label are keep-as-is. Any slice that touches them is out of spec.
- **Chat chrome branches on the existing patent-IDE-mode context key** — the same seam the patent welcome-title override already uses. The placeholder override lives beside the title override; the problems-counter and "Local"-chip hides are new when-clauses on that key. No new seam.
- **Account section renders only data the flowleap auth provider already fetches** (profile, subscription snapshot with status and period end). The single new seam surface in this PRD is one method on the existing patent-backend-client interface that fetches the Polar customer-portal URL from the invoices endpoint. No new backend endpoints; no avatar (would need a backend change — deferred).
- **Sign-out in the Account section delegates to the existing auth provider sign-out**; the native Accounts menu keeps working unchanged.
- **Token-expiry nudge is client-only**: the auth provider already tracks the session token's expiry; a status-bar item appears at ≤3 days remaining and triggers the existing sign-in flow when clicked. No modal, no toast.
- **Two-gears collision is resolved with icons, not names**: the container keeps the name "FlowLeap Settings" (it is the glossary-ratified single front door for Settings, now including Account) and takes the FlowLeap brand-mark SVG; the Projects container takes the briefcase codicon; the core Manage gear is untouched.
- **The Projects webview is replaced, not polished**: register the already-written native tree provider, wire inline and context-menu actions via native menu contributions reusing the existing well-named command titles, then delete the webview and its message protocol. The filter box is superseded by native type-to-filter; the full-width New Project button is superseded by the view-title action plus a views-welcome button for the empty state.
- **A tooltip stopgap ships first and independently**: the three webview tooltip strings become action verbs so the current build is usable while the tree rewrite proceeds. The stopgap is deleted with the webview.
- **Project Status is exactly four values** — Active (default), In Review, Complete, Archived — per the ratified glossary entry. Legacy stored statuses map at the config-read boundary: draft → Active, in-progress → Active, review → In Review. Migration is a pure function; stored configs are rewritten lazily on next write, not mass-migrated.
- **Project Type is exactly six values** — Patent Analysis, Prior-Art Search, Freedom-to-Operate, Patent Landscape, Claim Analysis, Custom — each with icon, creation-placeholder example, and notes template. Type is an organizational label and template seed only; no coupling to skills/recipes in this round. Invalidity work belongs to Patent Analysis.
- **Rename and delete are new commands** surfaced in the context menu; delete requires explicit confirmation and moves the project folder to the OS trash rather than hard-deleting.
- **CJK character maps ship as bundled assets** from the pdfjs distribution, served through the webview asset scheme; the CDN reference is removed. Bundle size is accepted (owner-approved trade-off for offline correctness).
- **Lazy rendering uses viewport observation**: pages render when scrolled near, placeholder boxes preserve layout, far-offscreen canvases may be released. First-paint waits only for the first visible pages.
- **Find-in-document builds on the existing text layer**: input in the toolbar, match count, next/previous, highlight styling from theme tokens. No regex mode.
- **OCR safety**: output paths built with the platform-portable URI join; a pre-write existence check prompts overwrite/cancel; progress is cancellable and reports page counts the backend already returns; all user-visible strings localized and vendor-neutral.
- **All lanes are file-disjoint** (core workbench chat/markers · patent-agent settings/auth surfaces · UI-shell projects extension · pdf-preview extension) so concurrent agents avoid the shared-index hazard; each agent stages only its own paths.

## Testing Decisions

- Good tests here assert **external behavior**: what string a mode presents, what items a tree returns, what a mapping function yields for a legacy value, what message the webview posts — never internal call order or private state.
- **Chat chrome**: extend the existing chat widget unit-test patterns that already cover the patent welcome-title override to also cover per-mode placeholders under the patent-mode key; when-clause registrations are asserted by contribution-level tests where such patterns exist, otherwise verified in the HITL smoke.
- **Projects**: status/type legacy mapping and the four/six-value models are pure functions with table-style unit tests (one snapshot-style deep-equal per table, per repo test guidance). Tree item shape (label, description, icon id, context value) is asserted through the provider's public interface. Follow the existing extension test layout in the UI shell; use a bare substring filter when running the shared vitest tree.
- **Settings/Account webview**: rendering is driven by a provider-state fixture (signed-out / trial / active / cancelling); assert the posted webview state object, not the HTML.
- **Backend-client portal-URL method**: unit test on the existing client seam with the established mocked-response pattern used by the other typed tools; 401/402 behavior inherits the seam's existing typed errors.
- **pdf-preview**: text-extraction and path-building logic unit-tested (existence-check prompt, portable joins, legacy-vs-new filename collisions); rendering behavior (CJK glyphs, lazy render, find highlighting) is verified in the HITL smoke with a JP patent PDF and a 40+ page US patent as fixtures.
- **HITL acceptance issue** closes the PRD: live smoke across all four lanes on a real build (placeholders per mode, hidden counters, Account section in all four subscription states, portal round-trip, tree actions incl. rename/delete + migration of a legacy project, CJK PDF, long-PDF scroll, find, OCR overwrite prompt).

## Out of Scope

- Any change to the model picker, "Default Approvals", "CHAT" panel title, or "Agent" mode label (owner-locked).
- A dedicated profile/account page or editor tab (Account lives in FlowLeap Settings — decided against a new surface).
- Avatar display (needs a backend profile change; deferred until the section feels bare without it).
- Backend endpoint changes of any kind.
- Coupling Project Type to skill/recipe invocation ("FTO project suggests the FTO recipe") — noted as a future follow-up.
- An "Invalidity" or "On Hold" project status/type (ratified out in the glossary).
- pdf-preview quality-of-life tail, filed as backlog, not in this wave: wiring the dead zoom/scroll settings and zoom persistence; zoom keeping scroll anchor + Ctrl+scroll zoom; outline/thumbnail sidebar and jump-to-figure (deserves its own design pass); fit-to-page/rotate/save-as/dark-invert reading mode.
- Renaming "FLOWLEAP: PROJECTS" title casing, mobile-sheet CTA leak, and other agents-window leftovers tracked elsewhere.

## Further Notes

- The grill ratified glossary entries for **Project Status** and **Project Type** and updated **FlowLeap Settings Sidebar** in `CONTEXT.md`; slices must use that vocabulary in user-facing strings.
- The consolidated review evidence (with verified file:line anchors for every finding) lives in `docs/reviews/2026-07-11-ui-review-findings.md` — slice authors should pull exact locations from there rather than re-deriving them.
- Suggested slicing (4 lanes, ~13 issues): chat-chrome (1); Account section (1), settings polish (1), icon pass (1), token nudge (1, P2); projects stopgap tooltips (1, ships first), native-tree switch + taxonomy + migration (1), rename/delete (1, after the tree); pdf cmaps (1), lazy render (1), find (1), OCR safety + micro-fixes (1); HITL acceptance (1). Plus 4 unassigned backlog issues for the pdf tail.
- The dead native tree provider predates this PRD; the tree-switch slice inherits it as a starting point, not a spec — its icon/status scheme must be updated to the ratified four-status model.
