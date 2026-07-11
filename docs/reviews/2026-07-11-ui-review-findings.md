# UI & Product-Surface Review — Consolidated Findings (2026-07-11)

Four-agent review: workbench/chat design vs. patent-AI bar, FlowLeap projects extension UX,
pdf-preview extension UI, and user profile/account evaluation (Clerk + flowleap-backend).
Key file:line claims spot-checked against the working tree on 2026-07-11.

**Owner decisions already locked:**
- Model picker label "Anthropic: Claude Sonnet 4 · Medium" **stays as-is** (owner likes it). Do not touch.
- Account surface = extend the existing FlowLeap Settings webview; **no dedicated profile page**.

---

## A. Workbench + chat design (task 1)

Verdict: the product already reads as a patent tool at the content layer (report rendering,
project tree, patent-voiced follow-up suggestions, trial pill, "Ask FlowLeap..." status entry).
Residual coding-IDE leakage is concentrated in the chat input/footer strip and a few labels.
No rebuild — every fix is a string, icon, gate, or token swap.

| # | Sev | Problem | Where |
|---|-----|---------|-------|
| A1 | HIGH | Chat input placeholder "Describe what to build" — coding-copilot voice in the most-looked-at control. The patent override in `chatWidget.ts:1269-1286` only fixes the welcome title, not the placeholder. | `src/vs/workbench/contrib/chat/common/chatModes.ts:713` |
| A2 | MED | "Local" / "Default Approvals" agent-runtime jargon in chat footer. | `src/vs/sessions/services/sessions/common/session.ts` (SESSION_WORKSPACE_GROUP_LOCAL); `src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts:480`; `src/vs/sessions/contrib/providers/copilotChatSessions/browser/permissionPicker.ts:115` |
| A3 | MED | Problems counter (⊗0 ⚠0) in status bar — dev residue, registered with no when-clause. Gate behind patentIdeMode. | `src/vs/workbench/contrib/markers/browser/markers.contribution.ts:572` |
| A4 | LOW-MED | Beaker activity-bar icon for FlowLeap sidebar reads "science experiment". | `extensions/flowleap/package.json:32` |
| A5 | LOW | "Agent" mode label, "CHAT" panel title. | `chatModes.ts:713`; `src/vs/workbench/contrib/chat/browser/chatParticipant.contribution.ts:42,55` |

Strengths to protect: report rendering + `.flowleap/` project structure; follow-up suggestion
links (Freedom-to-operate / Map the landscape / Forward citations); save-confirmation chip with
EPO OPS provenance; trial pill; patent welcome-title override.

Gate note: `patentIdeMode` is set true unconditionally at
`src/vs/workbench/browser/contextkeys.ts:120` — dependable, but A2/A3 are *new* when-clauses.

## B. FlowLeap Settings page

Strongest surface in the review — card layout, Configured badges, teach-where-to-get-the-key
placeholders, privacy explainer, auto-test-after-save all praised.

| # | Sev | Problem | Where |
|---|-----|---------|-------|
| B1 | MED | Two identical gear icons in activity bar (FlowLeap Settings container + core Manage gear). Page is really a credentials/keys page. → icon `$(settings-gear)` → `$(key)`, consider renaming container "API Keys". | `extensions/copilot/package.json:6320` (container), `:6296` (view icon) |
| B2 | LOW-MED | "BYOK" jargon on primary button "Add AI Model (BYOK)". | `extensions/copilot/src/extension/patentai/vscode-node/patentDataKeysPage.ts:419` |
| B3 | LOW | Key-location hints live only in password-field placeholders — vanish on click/paste. Move to persistent captions. | `patentDataKeysPage.ts:433,437,456` |
| B4 | LOW | Privacy note mispositioned (describes patent-data keys but sits above AI Model card boundary). | `patentDataKeysPage.ts:423` |

Target layout with the new Account section: Account → AI Model → privacy note → EPO OPS →
USPTO ODP → footer.

## C. FlowLeap projects extension (task 2)

The shipped sidebar is a hand-rolled webview (`extensions/flowleap/src/projectSidebar/projectTreeProvider.ts:182-714`).
A fully-written **native TreeDataProvider with correct codicons + rich tooltips sits dead in the
same file** (`:32-180`, never registered — verified zero external references).

| # | Sev | Problem | Where |
|---|-----|---------|-------|
| C1 | HIGH | Three hover-only action buttons are raw emoji with noun tooltips: 📝 "Notes", ● "Status" (a bare black dot), 📦 "Archive", ↩ "Unarchive". Owner: "I don't know what they do." | `projectTreeProvider.ts:621-627` |
| C2 | MED | Actions hover-only + no right-click context menu — undiscoverable. | CSS `:453-465` |
| C3 | MED | No rename, no delete/remove — archive is the only management action. | extension.ts commands |
| C4 | MED | Status system illegible: per-row dots duplicate the group header and the "draft" dot is faded gray (`opacity:0.5`) on the user's *active* projects. | `projectTreeProvider.ts:405` |
| C5 | MED | "DRAFT" is the wrong default status word for new active work (loaded term in patent practice — draft application/claims). Wants New/Active/Open. | `:53,60,541` |
| C6 | MED | Type labels "Custom"/"Patent" carry no information in a patent app; should name the investigation kind (FTO / Landscape / Prior Art / Claim Analysis) or be dropped. | `:92-94,260-262` |
| C7 | LOW-MED | "+ New Project" uses `--vscode-focusBorder` as button fill + hardcoded `color:white`; native primary buttons use `--vscode-button-background/-foreground`. | `:308,494-495` |
| C8 | LOW | Timestamp column (2w/1w/4d) ambiguous created-vs-modified; needs tooltip. | webview render |

**DECISION REQUIRED (for grill):**
- **Option A (polish webview):** fix tooltips (one-liners), load codicon font, show labeled/visible actions.
- **Option B (native tree):** register the already-written `ProjectTreeProvider`, wire inline
  actions via `contributes.menus` `view/item/context` (free native tooltips, right-click menu,
  theme icons), delete the webview + dead code, add rename/delete + visible status label.
- Orchestrator lean: **B**, with C1's tooltip fix shipped immediately either way.
- Creation flow (type quick-pick → name → scaffold → open) is good — keep regardless.

## D. pdf-preview extension (task 3)

Competent foundation: full `--vscode-*` theming, retina rendering, keyboard nav, text-selection
layer, page-number input, quick/OCR extract buttons.

| # | Sev | Problem | Where |
|---|-----|---------|-------|
| D1 | HIGH | CJK cmaps fetched from CDN, blocked by webview CSP → JP/CN/KR patents render blank/garbled. Bundle cmaps from pdfjs-dist + serve via asWebviewUri. | `media/pdfPreview.js:95`; CSP `src/pdfEditorProvider.ts:198` |
| D2 | HIGH | All pages rendered up-front, serially, full-res retina canvases → slow first paint + OOM risk on 40-page patents. Needs IntersectionObserver lazy render. | `pdfPreview.js:123-139` |
| D3 | HIGH | No find-in-document (Ctrl+F) — can't locate a claim term or reference numeral. Text layer already exists, so feasible. | feature gap |
| D4 | MED | OCR silently overwrites `<name>.md` + images beside the PDF, no confirm, `/`-separator paths broken on Windows; progress non-cancellable; message leaks "Mistral", tooltips leak "PDF.js"; strings not nls-localized. | `src/pdfEditorProvider.ts:86,90-114,226,230` |
| D5 | MED | Declared config dead (`defaultZoom`, `scrollMode` never read; scale hardcoded 1.0); zoom not persisted. | `package.json:84-100`; `pdfPreview.js:19` |
| D6 | MED | Zoom re-renders every page synchronously and loses scroll position; no Ctrl+scroll zoom. | `pdfPreview.js:211-228` |
| D7 | LOW-MED | No outline/thumbnail sidebar (`getOutline()` unused) — patents have Description/Claims/Drawings structure; no jump-to-figure. | feature gap |
| D8 | LOW | Fit-to-width uses page-1 dims for whole doc; no fit-to-page, rotate, save-as, dark/invert reading mode. | `pdfPreview.js:265-276` |
| D9 | LOW | `showError()` injects unescaped HTML; `pdf-preview.extractText` no-ops when a text editor is active; mixed MS/FlowLeap copyright headers. | `pdfPreview.js:308-315`; `src/extension.ts:81-102` |

## E. User profile / account (task 4)

**Verdict: no dedicated profile page.** Backend already exposes everything needed; auth provider
already fetches profile + subscription snapshot. No new backend endpoints for MVP.

Backend inventory (flowleap-backend):
- `GET /api/profile` → id/email/name/plan/credits (`src/routes/api.ts:44-56`) — IDE already calls it.
- `GET /billing/subscription` → status (incl. trialing), periodEnd, cancelAtPeriodEnd
  (`src/routes/billing.ts:56-72`) — IDE already calls it via `getSubscriptionSnapshot()`.
- `GET /api/invoices` → **Polar customer portal URL** (`src/routes/api.ts:441-457`) — unused by IDE.
- `GET /api/analytics?days=` → patent-activity counters (`api.ts:302`) — website-only today.
- `plan`/`credits` largely vestigial under BYOK (usage always 0, ADR 0004).
- Avatar: Clerk `imageUrl` not exposed; 1-line add to /api/profile if wanted.

Gaps to close:
| # | Sev | Gap |
|---|-----|-----|
| E1 | MED | Paid user sees subscription status nowhere (trial pill hides once active/canceled). |
| E2 | MED | No "Manage subscription" (Polar portal) link anywhere in the IDE despite the endpoint existing. |
| E3 | MED | 30-day token expiry tracked client-side (`flowleapAuthProvider.ts:63,406-413`) but never surfaced → silent auth death, discovered via 401. |

Plan: **one issue** — Account section at top of FlowLeap Settings webview (email/name, status
pill Trial-N-days/Active/Cancels-on-date/None, Manage subscription button → portalUrl) + **one P2
issue** — token-expiry nudge (status bar/toast within N days of `_tokenExpiresAt`).

Existing surfaces to reuse, not duplicate: native Accounts menu (sign-out), Setup tree "Account"
row, trial countdown status bar, 402→trial notification in `patentBackendClient.ts:571+`.
