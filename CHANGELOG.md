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

## [0.9.0] - 2026-10-21

### Added

- **Patent drawings from a geometry scene.** The Patent Agent builds figure sheets for an
  application from a scene the attorney describes or sketches: line art with numerals and
  lead lines, section views, flowcharts and block diagrams, laid out on EPO or USPTO sheets.
  Every sheet comes with a receipt that names each rule it checked and each numeral it drew.
- **Gate buttons in the drafting loop.** The feature list, the claims and the findings open
  with gate and waive buttons in the editor title; a click rewrites `checklist.md`. Each
  drafting tool ends with the next file to open and the next step to take, and the
  checklist carries the attorney's map of the whole loop. New: claim decisions with a
  `remove_claim` tool, and an Inventor Questions document for the facts the draft still
  needs.
- **A Prompts view page for drafting with drawings** walks through the loop from idea to
  filing set.
- **Patent law is read from the office's own page.** For a law question the agent fetches
  the MPEP section, the EPC article, the EPO Guidelines part or the PCT rule from the
  office's site, quotes only the text the page returned, and cites the URL and the edition.
  The `legal-research` skill is the method and lists the official sources per office.

- **Remote Access: follow your Agent Sessions and Editor Chats from your phone.** Switch
  Remote Access on in the Agents Window title bar, pair your phone by scanning the QR code
  (or paste the pairing code on another computer), and open `remote.flowleap.co`. The phone
  lists this computer's Agent Sessions and Editor Chats, shows each turn as it streams,
  lets you allow or skip a tool call, and sends the next message. Several phones can follow
  one computer, and one phone can follow several computers.
- **Nothing readable leaves your machine.** The phone and the computer share a key at
  pairing time, and everything between them is encrypted end to end. FlowLeap's relay only
  checks that both sides are the same signed-in user and forwards bytes it cannot read; it
  stores no content and nothing while your computer is offline. Remote Access needs an
  active subscription or trial.
- **Keep awake while followed.** While Remote Access is on and an Agent Session runs, the
  Mac stays awake so the phone keeps following. The setting
  `flowleap.remoteAccess.keepAwake` turns this off.
- **Manage Viewers** lists the paired phones and computers and removes any of them. Signing
  out of FlowLeap on the computer removes all of them.

### Changed

- **The legal search tools are retired.** `search_legal` and `legal_search_guide` are gone
  from the tool picker; the skills that used them now point at the official pages. The
  bundled CLI skills are at flowleap-cli v0.12.0, which removes the `legal` command, and
  the plugins pack is at 2.6.0.
- **Invalidity charts take web page text as validated evidence**, with a source label and
  an open point for what the page could not settle, and list one reference per publication
  when a figure anchor carries no kind code. The Round Report asks for ids and echoes the
  mapping it used.
- **Editor Chats are stored with a neutral title** on the computer's session catalog while
  Remote Access is on ("Editor chat, <date>"); the real title stays in memory and on the
  encrypted wire only.
- **From the phone, a tool call can be allowed once or skipped**, never allowed for the
  rest of the chat. Standing approvals are given at the computer.


### Fixed

- A user's own Anthropic key works on a Hosted Workspace. The BYOK Anthropic provider now
  sends to `https://api.anthropic.com` explicitly instead of letting the SDK read
  `ANTHROPIC_BASE_URL` from the server environment, where the hosted install points it at
  the agent host's key proxy; the proxy replaced the user's key and every request failed
  with 401 "invalid x-api-key". Mistral and OpenRouter were not affected.

## [0.8.0] - 2026-10-11

### Added

- **Patent AI in Agents Window Claude sessions.** A Claude session in the Agents
  Window now gets a "Patent Data" tool set with every patent tool, including
  `search_npl` and `get_npl_work`, and a **Patent AI** agent in the agent picker. The
  agent file (`patent-ai.agent.md`) is generated from the editor Patent AI prompt. It
  uses the tool names that Claude sees (`mcp__client__*`) and tells Claude to get
  patent data only from these tools, not from other patent MCP servers. The tools use
  your EPO and USPTO keys from FlowLeap Settings. The editor Patent Agent chat is
  unchanged. (#609, #612, #613)
- **Non-patent literature search with OpenAlex.** The new `search_npl` tool searches
  more than 250 million works. It filters by year range, open access and publication
  type, and shows the date, venue, DOI, citation count, abstract and open-access link
  for each result. The Patent Agent now uses it first for literature, then
  `search_academic` as a second pass. (#607)
- **Examiner-cited papers resolved.** The new `get_npl_work` tool resolves one cited
  paper, from the citation string or a DOI, to its OpenAlex record. `get_patent_details`
  with `resolveNpl` resolves every cited paper of a patent at once. Only a matched
  record is shown as the cited paper; other hits are shown as possible matches. (#611)
- **Semantic Scholar key in FlowLeap Settings.** An optional third card stores your own
  Semantic Scholar API key. Academic search then uses your key's rate limit, not the
  shared public limit. (#610)
- **Your own links in the Browser launcher.** A new **My links** section at the top of
  the Browser view holds links that you add with **+ Add link** (name optional, URL
  required). Remove a link with ×. The Unified Patent Court section also has a link to
  the UPC Opt-out Registry. (#618, #620)
- **Prior art on a patent** in the Prompts view: a prior-art search on a publication
  number, with a recall check against the documents the examiners cited. The "Read a
  claim properly" prompt now takes a publication number. (#615)

### Changed

- `search_academic` names its real sources (Semantic Scholar and arXiv), takes a year
  filter, and shows one status line per source, for example when a source is rate
  limited. (#608)
- The `sep-declarations` skill counts ETSI SEP declarations from the ETSI views on the
  PATSTAT server first. The download of the ETSI export is now only a fallback. (#606)
- The prior-art and Find Better skills search with classification codes and citations
  as well as keywords, read each result set in full, and report how many of the
  examiner-cited documents the search found, with a reason for each miss. (#616)
- Agents Window skills re-vendored at flowleap-cli v0.11.1: the NPL recall rules,
  `npl-work` and `biblio --resolve-npl` in the flowleap-patent and flowleap-npl skills.
  (cli#141, cli#145)
- In Patent IDE mode, the Changes view in the Agents Window no longer offers pull
  request, merge or checkout actions. Commit, Sync and Discard stay. Developer mode is
  unchanged. (#614)
- `get_patent_details`: when a full-text section comes from another document than the
  one requested (for example, WO text for a Euro-PCT EP publication) or is not in
  English, the section now says which document and which language it is. (#621)

## [0.7.0] - 2026-10-09

### Added

- **Application Drafting.** The Patent Agent drafts a full patent application for the
  US or the EPO from an invention disclosure. Each matter lives in
  `drafting/<matter>/`: a feature list and a figures list that you confirm, the claims
  that you approve, and `draft-application.md`. Every paragraph names its source, and
  every technical gap becomes an Inventor Question. Code checks the draft (antecedent
  basis, claim dependencies and numbering, reference numerals, abstract length,
  literal basis) and writes `findings.md`. Export to Word is blocked while an Error is
  not waived or an Inventor Question is open. Start it from the new Application
  Drafting card on the home dashboard. (#562)
- **Filing formalities for drafts.** Inventor Questions get an answer slot in
  `inventor-answers.md`, and `checklist.md` names your next step after each drafting
  step. Export writes separate description, claims and abstract .docx files in the
  office page layout (Rule 49 EPC, A4 with line numbers; 37 CFR 1.52, Letter), a full
  review copy, and `filing-manifest.md` with the claim count, estimated pages,
  drawing sheets and a proposed abstract figure. New checks: one sentence per claim,
  EPC Rules 43(6), 43(7) and 47(4), and an estimated page count over 35. (#582)
- **Unified Patent Court: filing preparation and case navigation.** Three new skills:
  `upc-filing-prep` gives a checklist and a go / not-ready verdict for a filing and
  stops at the court portal; `upc-case-navigator` lists the next filings for a case,
  with the side that files, the rule, the period and the trigger, but never a calendar
  date; `upc-representative-start` covers registration and first steps. The skills
  include reference files for the seven filing families and the 2026 court fee table.
  (#576, #581, #584)
- **UPC seed prompts in the Prompts view:** UPC: which division, UPC: opt-out check,
  UPC: what to file next, UPC: prepare a filing, UPC: court fee, UPC: register as
  representative. (#583, #584)
- **Unified Patent Court links in the integrated browser.** A new section in the
  Browser launcher opens the UPC CMS Front Office and the UPC CMS Portfolio. (#587)
- **Mistral as a model provider.** Mistral is now in Manage Models with its own API
  key field, beside Anthropic, OpenAI and the others. Before, it was available only
  through a Custom Endpoint. Use a paid Mistral key: the free tier is refused. (#555)
- **The `.flowleap/` folder.** FlowLeap reads skills, instructions, prompts and agents
  from `.flowleap/` in the workspace and from `~/.flowleap/` for your own files. It has
  the same layout as `.github/`: `skills/<name>/SKILL.md`,
  `instructions/*.instructions.md`, `prompts/*.prompt.md`, `agents/*.agent.md`, and
  `.flowleap/instructions.md` for instructions that apply to every request. The New
  Skill, Prompt, Instructions and Agent commands now create the file in `.flowleap/`.
  `.flowleap/` wins over `.github/` and `.claude/`. A built-in skill wins over your
  skill with the same name; to add firm steps to a built-in workflow, use an
  instructions file with `applyTo: "**"`. (#579)
- **Your profile picture as the account avatar.** The Accounts icon in the activity
  bar and the Agents Window title bar show the profile picture of your FlowLeap
  account. Without a picture, the default icon stays. (#586)

### Changed

- **Markdown files open in the Markdown Editor.** A `.md` file now opens rendered and
  ready to edit in place, not as a read-only preview. Reopen With still gives the
  source text. (#563)
- **HTML files open rendered.** A single click on an `.html` or `.htm` file in the
  Explorer opens the rendered page in the editor. It reloads when the file changes.
  Open HTML Source in the editor title bar shows the source. (#554)
- **Hosted Workspace: one sign-in.** The sign-in at the workspace gate now also signs in
  the Patent Agent sidebar. The sidebar no longer asks for a second sign-in. (#548, #592)
- Hosted Workspace: the server package now bundles the FlowLeap CLI version that the app
  vendors its skills from (`scripts/skills-drift-manifest.json`), not a fixed v0.9.1.
  (#599, #600)
- Hosted Workspace: new `update.sh` and `reset.sh` scripts. An update checks the
  package hash, keeps the previous package and rolls back if the server does not
  start; it does not touch user data. A reset clears one workspace for the next
  user. The nginx gate now resolves the backend at run time. (#588)
- HTML reports and dashboards: the agent now builds charts with Chart.js from the pinned
  jsDelivr CDN (data stays inline in one file) instead of hand-built inline SVG. Inline SVG
  is reserved for graphics the user wants offline or editable. (#601)
- Unified Patent Court skills: `upc-rop-explainer` gave wrong meanings for 13 Rules of
  Procedure and missed some periods; they are corrected against the official
  consolidated text. `upc-opt-out-actions`, `upc-opt-out-check` and
  `upc-division-router` are corrected too. (#567, #576)

### Fixed

- The status popup and status bar said "Sign in to use FlowLeap AI features" when you
  were signed in to FlowLeap. Sign-in buttons opened the GitHub setup dialog; they
  now open FlowLeap sign-in. The Accounts menu showed the FlowLeap account twice.
  (#585)
- Hosted Workspace: Install on an MCP server in the gallery showed "Not supported". The
  browser cannot run a server, so the install now goes to the server: the server is added
  to the remote user `mcp.json` and starts there. "Install in Workspace" is unchanged.
  (#593, #598)
- Hosted and web client: a source anchor in a saved report, such as
  `US6265989B1:claims:1:en`, did nothing when clicked in the Markdown preview. It now
  opens the patent reader at the claim or passage, after the same "Allow ... to open
  this URI?" question as on desktop. (#549, #591)
- An HTML file that loads a chart library from a common CDN (cdn.jsdelivr.net, unpkg.com,
  cdnjs.cloudflare.com, Google Fonts) now renders in the editor. The page still cannot
  send network requests. The Patent Agent tells you that the file opens rendered in the
  editor, not "open it in a browser". (#589, #597)

## [0.6.0] - 2026-10-06

### Added

- **Find Better: post-grant prior-art discovery.** Start from a granted patent. The
  Examiner Baseline collects every document each office cited across the family,
  computed from the offices' own records, with missing records shown as gaps. Three
  expansion tracks then search beyond it: backward citations two hops deep, inventor
  and author networks, and classification combined with the claim's discriminating
  terms, with a term-drop pass and title-phrase queries for old art. The report shows,
  per independent claim, the examiner's best art beside the best art found as
  disclosed-element counts, names only the documents that were scored, and says
  "search incomplete" when a track did not run. (#510, #513, #530, #534, #541)
- **Search Statement.** A claim becomes a concept table and a Boolean search
  statement with a copy button and an "Open in Espacenet" link, and a warning when
  the statement has no discriminating term. (#512)
- **Three prompts in the Prompts view:** Find Better, Search Statement, Examiner
  Baseline. (#525)
- **FlowLeap: Preview HTML File.** Opens a generated dashboard or any single-file
  HTML page in a preview panel. (#536)

### Changed

- Bundled CLI skills updated to flowleap-cli v0.10.0 (Find Better recipe, Search
  Statement reference). (#551)
- Examiner-cited references without an X or Y category now count as examiner art,
  so US-origin patents can be analysed. (#534)
- The second read retries once on a network error and asks for at most two re-saves
  while objections stay open. (#541)

### Fixed

- Priority dates were printed as "[object Object]" in patent details, summaries and
  comparisons. (#524)
- Hosted and web client: the patent tools were not offered to the chat; settings,
  sign-in, model keys and chat history are now kept on the server (#545, #547);
  webviews such as the Markdown preview were blank; the sign-in landing page was
  branded as Visual Studio Code; the integrated browser is hidden where it cannot
  run (#536); the server extension host crashed on start (#521).

## [0.5.1] - 2026-10-05

### Fixed

- Agent Sessions could not start in the packaged 0.5.0 build (missing agent
  host entry).

## [0.5.0] - 2026-09-30

### Added

- **Agent sessions run in a dedicated agent host.** Claude sessions in the
  Agents Window now run in their own process, the same way upstream VS Code
  runs them. You get several chats in one session (New Chat in This Session),
  forking a chat, a side chat, renaming and deleting sessions, and quick chats.
- **Your existing Claude Code sessions appear in the Agents Window.** Sessions
  you started from the Claude CLI in a terminal are listed under External and
  can be resumed there.
- **The Claude agent SDK downloads once, on first use.** The first Claude
  session after installing or updating fetches about 100 MB from the FlowLeap
  release page, then works offline. Sessions still sign in with your own
  claude.ai account or Anthropic key, never through FlowLeap.

### Changed

- **Updated to the VS Code 1.140 baseline.** The whole editor and the Agents
  Window are now on upstream's September 2026 code, so upstream fixes and
  features arrive as they ship.
- **New sessions ask before editing.** The permission mode for a new Claude
  session starts as "Ask Before Edits". Auto and Bypass are still in the
  picker.
- **Session logs keep no content.** The agent host's diagnostic logs record
  ids, timings and tool names only. Your prompts, model replies, tool output
  and file contents are never written to them unless you switch on a developer
  setting, and the debug-log export tells you when that setting is on.
- **The composer speaks patent.** After a session starts, the input suggests a
  patent research task instead of a generic chat prompt, and the recommended
  model for a new session is Sonnet.

### Fixed

- **OCR was failing for everyone with a sign-in message.** The document-AI key
  on the FlowLeap backend had expired. It is rotated, and a follow-up stops a
  backend provider error from ever looking like a sign-in problem.
- **The Mermaid preview logged an error at every launch.** It now enables the
  API proposal it needs.

## [0.4.0] - 2026-09-24

### Added

- **FlowLeap now runs on Windows on ARM.** Every release ships a system
  installer, a per-user installer and a `.zip` for arm64 machines, next to the
  x64 ones. Pick the installer that matches your processor on the download page.
- **FlowLeap now runs on Linux.** Every release ships a `.deb`, a `.rpm` and a
  `.tar.gz` for both Intel/AMD (x64) and ARM (arm64) machines. Install with
  `sudo apt install ./FlowLeap-*.deb` or `sudo dnf install ./FlowLeap-*.rpm`, or
  extract the `.tar.gz` and run `flowleap` from it. The packages are built
  against glibc 2.35, so they need Ubuntu 22.04 or later, Debian 12 or later,
  Fedora 36 or later, or an equivalent distribution. Linux has no background
  updater yet: FlowLeap tells you when a new version is out and you install it
  the same way.
- **Patent links in a Markdown report render as pills.** A publication number or
  a patent URL in an open report shows the title, the applicant and the latest
  legal-status events in place, without leaving the editor.
- **EP designated contracting states.** Legal-status answers for European
  patents now list the designated and extension states, and the per-event state
  lists are no longer dropped from the tables.
- **OpenRouter from the EU.** A new setting, `patent.openRouter.dataRegion`,
  sends your own OpenRouter key to `eu.openrouter.ai`. Keys whose workspace
  guardrail is limited to Europe now work.
- **A decision trail beside a patent deliverable.** Every graded deliverable
  now writes an investigation record that names the cutoff, the jurisdictions,
  the references dropped and why.
- **Prior-art reviews save two documents.** The client report and a working
  record now come from the same review, so the search strategy and the
  concepts and classifications searched reach the reader.
- **First launch opens on the three first runs.** A new First Runs tab shows
  the same three starting tasks as the welcome page and the trial email.
- **Opt-in activation counters.** FlowLeap asks once whether it may send four
  content-free counters (app launched, skill run completed, report saved, keys
  added). Never a file, a query, a matter or model output.

### Changed

- **Markdown editor updated to the VS Code 1.139 baseline**, together with
  the agent sessions window: compact session list, inline rename with F2,
  per-row progress and a Diff View submenu in the editor overflow.
- **Skills read the drawings first.** A structural feature is no longer marked
  unresolved before the figures have been read, and a search names the feature
  it tests.

### Security

- Ten upstream fixes from VS Code 1.136.2 to 1.139 applied, including wildcard
  IP patterns in the network filter (CVE-2026-81379), terminal auto-approval
  holes, MCP workspace trust, and apply-patch move-destination validation.

### Fixed

- **BYOK through OpenRouter** now retries without Anthropic beta headers when a
  provider rejects them, and recognises vendor-prefixed Claude ids in the tool
  search and context-editing gates.
- **The `patent.secondReadModel` setting is now read.** Its old dotted name,
  `patent.secondRead.model`, was dropped by the configuration layer.
- **The family tool reads the family it promises**, and the graph tool surfaces
  citable publication numbers.

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
