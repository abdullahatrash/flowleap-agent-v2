# Changelog

All notable changes to FlowLeap Patent AI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and version numbers follow [Semantic Versioning](https://semver.org/).

Add every user-visible change to `## [Unreleased]` in the same pull request that
makes it. Cutting a release renames that heading to `## [X.Y.Z] - YYYY-MM-DD` and
opens a fresh empty one — the release workflow copies the section verbatim into
the GitHub release notes, so write for the person downloading the app, not for
the person who wrote the patch. Changes with no user-visible effect (refactors,
test-only work, CI) belong in the commit message, not here.

## [Unreleased]

<!-- Nothing yet. Add entries under a `### Heading` as changes land. -->

## [0.3.1] - 2026-09-03

### Fixed

- **Exporting a Markdown file no longer silently overwrites a patent PDF.**
  Exporting `EP1234567.md` wrote `EP1234567.pdf` straight over a patent PDF you
  had downloaded under the same name, with no warning. FlowLeap now asks first
  when the target was not produced by the export itself, offering Overwrite or
  a safe `name.export.pdf` alternative. Repeat exports of your own file stay
  silent, so convert-on-save is unaffected. A folder whose name contains `.md`
  is also no longer mangled in the output name.
- **Chat now names the way out when no AI model is connected.** Signed out with
  no key of your own, sending a message failed with a bare "Language model
  unavailable" that pointed nowhere. Chat now offers **Sign In** and **Add Your
  AI Model** before the send, keeps the text you typed, and carries the same
  links in the welcome view and the model picker.

## [0.3.0] - 2026-09-03

### Automatic updates on macOS

- FlowLeap now updates itself. A new version downloads quietly in the
  background and installs when you next restart the app — no trip to the
  download page, no manual reinstall. You are never relaunched uninvited: the
  app shows a passive "Restart to Update" affordance and waits for you.
- Automatic downloads are deferred on metered connections, and the whole
  behaviour can be turned off in settings.
- Windows still uses the older notification: a toast tells you a new version
  exists and the Download button opens the download page.

### FlowLeap Trial models

- New accounts can start using the patent agent immediately, with no model
  provider key and no card. Trial models appear in the model picker for the
  duration of the trial, with the remaining budget and time visible in chat.
- Your own key always wins. If you have added an OpenRouter or Anthropic key,
  FlowLeap keeps using it and leaves the trial alone.
- When the trial's data budget runs low or runs out, the agent says so plainly
  and tells you what to do next, instead of failing mid-answer.
- Signing out pauses the trial models and says so, rather than telling you to
  add your own key.
- Onboarding now offers a subscription directly instead of a card-gated trial.

### Home and navigation

- A **Dashboard** view in the activity bar — recent projects, new-project and
  browse-files quick links, and a jump to your installed Skills.
- A **Browser** launcher in the activity bar, for opening patent databases and
  research sites beside your work.

### Chat

- **Find in chat** — `Ctrl+F` / `Cmd+F` searches a chat pane or chat editor and
  steps through matches newest-first.
- **Timestamps and token counts** — each completed response shows when it ran,
  how long it took, and the tokens it used, per model.
- **Prompt-cache warning** — changing model or options mid-session breaks the
  prompt cache and costs you money; the model picker now warns before it
  happens.
- Images and PDFs you paste, drag, or attach behave consistently across the
  chat panel, inline chat, and the Agents window: previews survive a reload,
  the same image is not shown twice for different tool calls, and attachments
  can be referenced inline.
- **Files from Disk…** added to the Add Context picker.
- The transcript stays where you put it — sticky scroll follows the last real
  turn, scroll position is kept between sessions, and switching sessions no
  longer makes the view jump.
- Text typed while a session is still loading is no longer discarded, editing a
  request keeps its symbol references, and both Start Over and discarding an
  edited request now ask first.
- Thinking and tool-call rendering cleaned up: headers render as markdown and
  stop overflowing, tool calls no longer jump while streaming or get stuck
  inside a thinking block, and a non-terminal tool failure no longer expands
  itself.
- Copying chat output into other applications keeps its formatting.
- Dirty editors are saved before a message is sent, so the agent reads what you
  actually see.

### Agents window

- Reopen the last closed chat or session with `Cmd+Shift+T`, close chat tabs
  with a middle click, and navigate with the mouse's back and forward buttons.
- Sessions can be renamed from the list, and a session's OS notification tells
  you when it finished while you were elsewhere.
- The Changes view now settles for folders that are not git repositories, and
  worktree and branch options are hidden when the folder has no usable
  repository.
- Worktree creation is serialized per repository and retries on a path
  collision, so two sessions starting at once no longer clash.

### Patent work

- **Figures can be saved to your workspace.** `get_patent_figures` previously
  could only show images inline; it now writes them to a directory you choose.
- **Honest search counts.** A filtered search reports how many results were
  actually filtered and echoes the query it really ran, instead of quoting a
  raw total that does not match the rows.
- **EPO backpressure is waited out** rather than reported as a failure, so a
  busy EPO no longer ends a search early.
- The agent cites its sources and quotes them accurately, keeps tool names and
  its own internal rules out of its answers, and makes list counts match the
  rows it actually shows.
- A `notes.md` in your project is now read as your standing instructions, not
  as evidence about a patent. `CLAUDE.md` instructions are off by default.
- Bundled skills updated to FlowLeap CLI v0.8.5.

### Fixed

- **PDF attachments now reach the model** when you are using your own
  OpenRouter or Anthropic key. Attaching a PDF to a chat message previously
  did nothing on those paths.
- Re-clicking **Sign In** while a sign-in is already in flight re-opens the
  browser instead of doing nothing.
- Chat Debug and Context Inspector no longer appear for new users.
- Terminal, editor, search, notebook, settings, source-control and extension
  views all had memory leaks that grew over a long session; a large batch of
  upstream leak fixes has been taken.
- Resizing panes, switching sidebars and scrolling long chat transcripts are
  measurably faster — layout work that ran while views were hidden or offscreen
  no longer runs at all.
- Terminal buffer-mark navigation no longer hangs, and a resize during disposal
  no longer throws.
- MCP servers: an explicit empty token scope no longer causes a sign-in loop,
  parse errors are readable instead of `[object Object]`, and a workspace MCP
  config nested under settings is recognized.

### Security

- Taken the upstream security hardening for this cycle: fetch-tool approval
  bypasses, skill-name escaping, chat-session import path traversal, a
  loopback XSS, trusted-domain parsing, stale secret handling, workspace-trust
  gaps, and origin validation for the web-worker extension host.

### Under the hood

- Rebased onto VS Code 1.135 (from 1.127), bringing the above upstream fixes
  and the current Electron.

## [0.2.1] - 2026-08-09

### Fixed

- A rejected model-provider API key now says so. Chat previously ended the turn
  with the provider's own wording — OpenRouter answers an unrecognised key with
  "User not found." — followed by a stack trace, which read as though your
  FlowLeap account were missing rather than your key being wrong. The message
  now names the provider, tells you to check the key, and links Manage Models,
  keeping the provider's text as a supporting detail. A key that never reached
  the provider is reported differently from one that was refused.

## [0.2.0] - 2026-08-09

### Patent analytics over PATSTAT

- **Portfolio analytics** — aggregate a named applicant's filings by CPC/IPC
  class, office, year, family, and grant status, with harmonized entity
  resolution. Every figure carries its PATSTAT Data Edition.
- **Guarded SQL** — write read-only `SELECT` queries against the `flowleap.*`
  semantic views for landscapes, grant rates, citation impact, and inventor
  analytics that the typed commands do not cover.
- **Graph analytics** — six graph operations over the worldwide DOCDB citation
  network: who cites a patent (examiner versus applicant origin), citation and
  family paths between two patents, family coverage, and an applicant's
  co-applicant network. Every edge is tagged with a confidence level and a
  PATSTAT row reference.
- The agent now routes between keyword analytics, structured aggregation, and
  graph traversal on the shape of the question rather than its wording.

### Provider-key handling

- The agent knows which patent-provider keys are connected and adapts instead
  of stalling: it does the work that needs no key, tells you exactly which key
  a blocked step wants, and resumes that step once you connect it.
- Key state is shown in the chat surface, so a missing EPO OPS or USPTO ODP
  credential is visible before a search fails.

### Bundled skills

- Updated to FlowLeap CLI v0.6.0 — refreshed provider-key setup guidance,
  authentication states, and search recipes.
- Added the `flowleap-patstat-graph` skill for the new graph analytics.

### Fixed

- Chat output panels no longer go blank when a streamed response re-renders.
- A patent lookup by number no longer drops its only matching record.
- An empty result set now reports that it is empty instead of reporting a
  size overrun, and a large result that is trimmed says so plainly.
- Class-based landscape questions route to portfolio analytics instead of
  free-text search.
- The GitHub Copilot walkthrough no longer appears in patent mode.

## [0.1.0] - 2026-07-24

First public release of **FlowLeap Patent AI** — an AI patent agent for
patent professionals, built on the VS Code platform.

### Patent research agent

- Chat-driven patent agent with 28 typed tools against the FlowLeap backend:
  EPO patent search (CQL, with natural-language query building), USPTO Open
  Data Portal search, applications and continuity chains, file-wrapper and
  office-action documents, enriched citation data (backward and forward, with
  X/Y/A relevance tagging), patent-law reference search (MPEP, EPC, EPO
  Guidelines), academic and non-patent literature search, claim analysis and
  comparison, patent details and figures, portfolio analytics, and report
  writing.
- 25 bundled patent skills covering the full lifecycle — invention disclosure,
  prior-art and novelty search, claim drafting and analysis, office-action
  response, freedom-to-operate, invalidity analysis, infringement charting,
  patent landscaping, maintenance-fee checks, and formatted patent reports.
- Project templates for common patent workflows.

### Bring your own key

- Model access is BYOK: connect your own API key (Anthropic, OpenRouter, and
  other providers) — prompts and documents go directly from your machine to
  your model provider.
- Dedicated settings page for managing model and patent-provider credentials
  (EPO OPS, USPTO ODP).

### Documents

- Built-in PDF viewer with OCR text extraction for prior-art documents and
  office actions.
- DOCX viewer and Markdown-to-PDF export for work products.

### Platform

- FlowLeap account sign-in for backend access, with a free tier for patent
  data.
- Agent sessions window for long-running, reviewable agent work.
- macOS builds (Apple Silicon and Intel) are code-signed, notarized, and
  stapled. Windows installers (system and per-user) are Authenticode-signed.
