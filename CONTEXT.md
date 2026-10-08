# FlowLeap Patent IDE — Domain Language

This repo is a fork of VS Code (Code-OSS) being shaped into **FlowLeap Patent IDE**, a
desktop app for patent examination workflows. The patent agent lives **in-tree** inside the
built-in `extensions/copilot/` extension (see `docs/adr/0001`). The glossary below is the
canonical vocabulary for patent workflows and for navigating this fork. General programming
concepts do not belong here.

Companion repos (separate contexts, not in this glossary): `flowleap-backend`
(Clerk auth, Polar billing, patent-data API) and `flowleap-website-v2` (marketing/download +
account dashboard, mints the extension's Clerk token).

## Product surfaces

**Patent Agent**:
The AI brain — the patent-adapted agent loop, ~70 tools, system prompt, and agent intent.
Ported into the built-in `extensions/copilot/` extension under `src/extension/patentai/`.
_Avoid_: "the extension" (ambiguous — there are two; this is the copilot one, not the UI shell).

**FlowLeap UI Shell**:
The `extensions/flowleap/` extension developed in-tree: theme, sidebar, home dashboard, chat
panel. Owns presentation; does **not** own the agent loop or auth.
_Avoid_: calling it "the flowleap extension" without qualifying — it is the UI shell only.

**Patent Skill**:
A deep patent-analysis workflow shipped as a `SKILL.md` (e.g. `prior-art`, `claim-analysis`,
`freedom-to-operate`, `patent-landscape`). Model-invoked, comprehensive, produces a
deliverable. Registered in `package.json` → `chatSkills`.
_Avoid_: building patent-analysis as coded "intents" — that duplicates the Skills.

**FlowLeap Settings Sidebar**:
The webview view behind the FlowLeap brand-mark icon in the Activity Bar (owned by the Patent
Agent extension, since it owns the key store) holding the user's **Account section** (signed-in
identity, subscription status, Manage-subscription link) and where the user enters BYO
patent-data keys — the EPO
OPS **Consumer Key + Consumer Secret** pair and the USPTO ODP **API Key** — and reaches the
BYOK model picker ("Add AI Model"). Keys go straight to SecretStorage; the view only ever sees
presence booleans, never stored values. It is the single front door for "Settings" in FlowLeap
surfaces (dashboard, Setup view, invalid-key toasts, menubar Preferences), auto-revealed on
startup for fresh installs, and links out to the native Settings editor for plain preferences.
_Avoid_: putting keys in the native Settings editor / `settings.json` (plaintext — forbidden by
ADR 0005); quick-pick/input-box chains for key entry (the pre-sidebar UX this replaced).

**Workspace-Assistance Command**:
A lightweight, **user-typed slash command** that helps the user *operate the file-rich patent
project* — not analysis. Distinct from a Patent Skill (a command is a shortcut, not a deliverable).
_Avoid_: conflating with Patent Skill.

**Project Type**:
The investigation kind a Patent Project was created as — one of **Patent Analysis** (a specific
patent/application is the subject, including invalidity work), **Prior-Art Search**,
**Freedom-to-Operate**, **Patent Landscape**, **Claim Analysis**, **Application Drafting**
(ADR 0012), or **Custom**. An organizational label and notes-template seed only; it does not
change agent behavior.
_Avoid_: adding an "Invalidity" type (that's Patent Analysis); coupling type to skill/recipe
invocation.

**Project Status**:
The lifecycle state of a Patent Project: **Active** (default for new projects; being worked on
or merely idle — idleness is shown by timestamps, not status), **In Review** (deliverable
drafted, awaiting attorney/client review), **Complete**, **Archived**. Exactly these four.
_Avoid_: "Draft" as a project status (in patent practice "draft" describes documents — draft
application, draft claims — not investigations; the legacy `draft` status maps to Active);
adding statuses for rare states like "on hold" (that's Active + an old timestamp).

## Marketplace & ecosystem

**FlowLeap Marketplace**:
The umbrella for FlowLeap's curated, free-to-install extension ecosystem: the Plugin
Marketplace, the MCP Registry, and the website marketplace hub that fronts both. v1 is
FlowLeap-curated only (no third-party publishing) and carries no Pro gating; paid packs would
arrive later over a separate authenticated channel, never via the public surfaces below.
_Avoid_: using "marketplace" bare when the Plugin Marketplace repo vs the MCP Registry matters —
they are different artifacts with different consumers.

**Plugin Marketplace**:
The single public git monorepo of FlowLeap plugins (`marketplace.json` at root, one directory
per plugin). It is both the discovery catalog and the update channel the app polls. The app
ships with this as its only default marketplace, pre-trusted; user-added marketplaces keep the
trust confirmation.
_Avoid_: hosting plugins inside the website repo; keeping the upstream Copilot marketplaces as
defaults.

**MCP Registry**:
The public read-only endpoint (hosted by the website) implementing the standard MCP Registry
v0 API, which the app's built-in Browse Marketplace UI consumes. Curated entries: vetted
third-party MCP servers useful for patent work, plus FlowLeap's own MCP server.
_Avoid_: conflating with the Plugin Marketplace (a git repo, not an API); treating it as
auth-gated (it is public in v1).

**Skill Pack**:
A plugin whose payload is a set of skills (`skills/<name>/SKILL.md`). Skills are distributed
**inside plugins only** — there is no standalone skill installer; "install a skill" always means
"install the plugin that carries it". Launch packs repackage the proven multi-harness CLI skill
families (personas, recipes, CLI tool skills), which work in Claude sessions because they use
the backend facade rather than in-app typed tools.
_Avoid_: "skill store" / standalone skill installs; unbundling the built-in Patent Skills into
packs (they stay bundled and are panel-chat-only).

## App updates

**Silent Update**:
The app-update contract: the desktop app downloads a newer release in the background and
installs it on the next restart. The user sees only a passive "Restart to Update" affordance
and can turn the behavior off in settings. The app never relaunches itself uninvited and never
sends the user to a browser to reinstall.
_Avoid_: "auto-update" meaning forced relaunch; conflating with plugin updates (the Plugin
Marketplace is the update channel for **plugins**, not the app).

**Update Feed**:
The endpoint the desktop app polls to learn whether a newer release exists for its exact
platform and architecture. It answers "no update" or exactly one release, and it is the single
authority on what version users receive.
_Avoid_: "download page" (a human marketing surface, not the feed); pointing the app at raw
release listings.

**Notify-Only Checker**:
The legacy update surface: a toast announcing a new version, whose Download button sends the
user to the download page for a manual reinstall. Retained only where Silent Update is not yet
armed; never shown alongside it.
_Avoid_: treating it as the update mechanism — it informs, it does not update.

**Stamped Build**:
A release build carrying its real version and release identity, injected at release time. Only
Stamped Builds participate in update checks; dev/local builds are unstamped and never poll.
_Avoid_: letting an unstamped build prompt for updates.

## Authentication & model path

**Model Path**:
How **inference** happens. FlowLeap is **BYOK** (ADR 0004 in the old setup): the LLM call runs
client-side through VS Code's native BYOK subsystem using the user's own provider key. There is
no inference proxy — the old backend chat proxy is retired (410).
On a **Hosted Workspace** the same Model Path runs on FlowLeap's server (ADR 0011).
_Avoid_: confusing the Model Path with the FlowLeap Session — one is inference, the other is sign-in.

**FlowLeap Session**:
How a user **signs in** to the paid product (billing, subscription, patent-data access).
A Clerk-minted `flowleap` JWT-template token, obtained via the system browser and returned over the
`flowleap://…/callback` deep link, stored in SecretStorage by `PatentAIAuthService`. This is the
**single** auth mechanism (see `docs/adr/0002` — the old parallel OAuth-PKCE flow was removed).
_Avoid_: "login token" / "GitHub session" — sign-in never touches GitHub; GitHub/Copilot token
methods are mocked so inference bypasses them.

**Patent-data Backend**:
`flowleap-backend`, reached by the patent-data tools (EPO OPS, USPTO, citation, legal RAG) at
`/v1/…`. Gated **live per request** on Clerk auth + Polar subscription state. This is what the
subscription pays for — **not** inference (which is BYOK), except for the narrow
**FlowLeap-Managed Inference** list below.
_Avoid_: "the LLM backend" — it serves patent data, and runs a model only on the named exceptions.

**FlowLeap-Managed Inference**:
The **exception list**: backend routes that run a model on FlowLeap's own provider account
rather than on the user's **Model Path**. Governed by backend ADR 0012 — *FlowLeap runs a
model only where the client cannot*: `/ocr` (Mistral; specialised model work), USPTO
office-action text extraction (the same Mistral OCR, invoked from the file-wrapper route —
public IFW documents, not user content), legal-search embeddings (must match the index they
are compared against), and `/analyst` (the website's analytics page, whose visitors have no
BYOK key at all). Its **target size is zero**;
additions require a decision, not a pull request.
_Avoid_: treating a new server-side model call as an ordinary backend call — that framing is
why query building and claim analysis sat here unnoticed until ADR 0012 removed them.

**Discriminating Term**:
The term in a search query that separates one invention from the millions of generic patents
in its technology area. A classification code is never discriminating: it names a
neighbourhood, not a house. Every query needs at least one.
_Avoid_: treating a broad category word ("artificial intelligence") or a CPC code as the
subject matter — both return the field, not the invention.

**Consent Verdict**:
The user's remembered answer to the one **FlowLeap-Managed Inference** capability that carries
their own content: Document OCR. **undecided** (default — asks), **always**, or **never**.
Stored per person, not per workspace, and reversible from the Privacy section of the FlowLeap
Settings Sidebar. Covers the PDF viewer's "Extract with OCR" only — USPTO office-action
extraction runs the same Mistral OCR over **published** IFW documents, which are not the user's
content and are not gated.
_Avoid_: calling **Once** a verdict — it authorises a single extraction and records nothing;
enforcing consent through the chat tool-confirmation affordance (a session on blanket
auto-approve skips confirmations, so the gate lives inside the operation).

**Patent-Data Keys**:
The user's own EPO OPS **Consumer Key + Secret** pair and USPTO ODP **API Key** — free
credentials from each office, entered in the FlowLeap Settings Sidebar. **Per-provider and
independent**: EPO-only and USPTO-only are valid states. During a **trial** the backend serves
patent data on FlowLeap's shared keys (no user keys needed); an **active** subscriber must
bring their own — a missing key blocks **only that provider's routes** (`data_keys_required`),
never the keyless tools (PATSTAT, legal, academic). A key gate is a **user-action stop**, not
an exhausted route: the agent must not substitute web-scraped data for a gated office.
_Avoid_: "provider keys" (CLI legacy naming — align on this term); bare "API keys" (collides
with the BYOK LLM key); framing the add-keys ask as a paywall — the keys are free.

## Remote Access

**Remote Access**:
The feature that lets a signed-in user follow and steer their own **Agent Sessions** from another
device. It is switched on per **Host** by the user. It moves the Agent Session, never the
FlowLeap Session or the Model Path: inference and files stay on the Host.
_Avoid_: "Remote Control" — that is Claude Code's name for an unrelated feature; "tunnel" — a
transport detail, not the feature.

**Agent Session**:
One conversation with the Patent Agent in the Agents Window: its messages, tool calls,
permission prompts and outputs. Distinct from the **FlowLeap Session** (sign-in).
_Avoid_: bare "session" wherever the two could be confused.

**Host**:
A desktop running FlowLeap, signed in, that offers its Agent Sessions to paired **Viewers**.
A user may have several Hosts. A Host that is closed or asleep offers nothing.

**Viewer**:
A device (phone, tablet, another computer) that follows a Host's Agent Sessions through the
**Relay**. A Viewer can read an Agent Session, answer its permission prompts and send it the
next message. Several Viewers may follow one Host at the same time.

**Pairing**:
The one-time act that lets a specific Viewer follow a specific Host. Both sides must belong to
the same FlowLeap user, and the Host must show the pairing to the user (code or QR). A pair is
remembered until the user removes it or signs out on the Host. Pairing is also where the two
sides agree the secret that keeps the Relay blind.

**Relay**:
FlowLeap's own server that joins a Host and its paired Viewers when neither can reach the other
directly. It checks that both sides are the same FlowLeap user and forwards bytes it cannot read.
It stores no Agent Session content and holds nothing while a Host is offline.
_Avoid_: "proxy" or "backend" — the Relay never sees plaintext and serves no patent data.

## Hosted Workspace

**Hosted Workspace**:
A FlowLeap instance that FlowLeap runs on its own server for **one user**, reached from a
browser with that user's **FlowLeap Session**. It is the complete app, server build and web
client, so Agent Sessions, the editor Patent Agent chat, skills, tools and files all work as on a
desktop. Its Model Path runs on the server: a FlowLeap-owned API key for Agent Sessions, the
trial or BYOK key for the editor chat (ADR 0011). Each user has their own isolated instance; an
instance holds no backend secrets and talks to the Patent-data Backend as any desktop does.
_Avoid_: "web version" / "cloud IDE" (too vague); confusing it with a **Viewer** — a Viewer
follows a Host elsewhere, a Hosted Workspace *is* the machine; treating its inference as
**FlowLeap-Managed Inference** — that list is about backend routes, this is a Model Path variant.

## Patent domain

**Prior-Art Search**:
Scoped to the **patentability / novelty search**: given an Invention Disclosure, find and rank the
*closest* prior art to support a novelty / non-obviousness read before filing.
_Avoid_: using "prior-art search" loosely for validity, FTO, or landscape searches — those are
distinct deliverables with different inputs and goals.

**Invention Disclosure**:
The input to a Prior-Art Search — a description of the invention to be assessed (its technical
features / draft claims). Not a product, not a granted patent.
_Avoid_: "the patent", "the idea" (too vague).

**Patent Family**:
The set of patent documents (across offices/jurisdictions) sharing a common priority — i.e. one
invention. The **dedup unit** of a Prior-Art Search: one row per family, represented by one member.
Non-patent literature (NPL) has no family — each item is its own row.
_Avoid_: treating each publication (US/EP/CN sibling) as a separate result.

**Relevance Category**:
The EPO/PCT relevance marker assigned to a cited reference, **per claim/feature**. Core triad:
**X** (relevant alone — destroys novelty), **Y** (relevant only in combination — inventive step),
**A** (background, non-prejudicial). Separate **date-status** flags: **P** (published in the
priority interval), **E** (earlier-filed, later-published "secret" prior art). One reference may
carry several.
_Avoid_: High/Medium/Low (loses the alone-vs-combination signal).

**Topic Analytics** vs **Portfolio Analytics** vs **Graph Analytics**:
The three analytics engines, split by *criteria shape*, not by metric. **Topic Analytics**
(the Google-Patents corpus engine) answers questions whose essential criterion is **free-text
keywords** over title/abstract ("quantum computing filings over time"); publication-level counts,
substring name matching, per-query cost. **Portfolio Analytics** (the PATSTAT aggregation
engine) answers questions expressible in **structured criteria** — named applicant
(entity-resolved, harmonized names), CPC/IPC class, office, year, family, grant status;
family-level counting, zero marginal cost. **Graph Analytics** (the PATSTAT relationship
engine) answers questions about **a named node and the relationships around it** — who cites a
patent (backward/forward, examiner vs applicant origin), the citation/family path between two
patents, a patent's family and priority network, an applicant's co-applicant network; every
relationship carries a confidence tag and row-level provenance. Routing rule: free-text
keywords → Topic; aggregate counts by structured criteria → Portfolio; a named node and its
connections → Graph. An ambiguous applicant name or publication number is an interaction step
(pick the entity/application), never a silent merge.
_Avoid_: "analytics" unqualified when the engines could disagree; "the PATSTAT engine" (PATSTAT
backs both Portfolio and Graph Analytics — say which); presenting numbers from multiple engines
in one chart without labeling each source.

**Data Edition**:
The provenance identifier of the PATSTAT snapshot behind Portfolio and Graph Analytics
(PATSTAT is published in discrete editions, ~twice yearly). Every Portfolio or Graph Analytics
answer carries its Data Edition; two answers are only comparable within one edition.
_Avoid_: treating Portfolio or Graph Analytics as live data — each answer is from a snapshot
with a name.

**Verified-Data Contract**:
The bar a data deliverable (e.g. a dashboard) must meet: every displayed value — chart, table,
or narrative sentence — is computed by executable code from recorded source responses, and the
deliverable carries its provenance (sources, parameters, Data Edition, timestamps) plus the raw
response data alongside it. Chat commentary *cites* a verified deliverable; it is not itself one —
conversational numbers are quoted from computed output, never re-typed from memory.
_Avoid_: calling model-transcribed numbers "verified"; treating charts as covered but prose as exempt.

**Effective Filing Date** / **Priority Date**:
The date a Prior-Art Search is measured against: a document is prior art if it was publicly
available before the application's effective filing date. A reference's own **publication date**
decides whether it counts; its **earliest priority date** matters only for E-category secret prior
art. Prior-art status is **jurisdiction-dependent** (US has a 1-year inventor grace period; Europe
applies absolute novelty).
_Avoid_: conflating "publication date" with "priority date" — they answer different questions.

**Find Better**:
The post-grant discovery deliverable: given a **granted patent**, find prior art earlier or
closer than what the examining offices cited, and show per independent claim the examiner's
best art beside the best art found, as disclosed-element counts. It sits between Prior-Art
Search (pre-filing, from an Invention Disclosure) and Invalidity Analysis (venue, grounds,
construction): it may feed an invalidity chart, it never states invalidity. "Nothing better
found" with a full **Examiner Baseline** is a complete result (ADR 0010).
_Avoid_: "better" as a model rating — the comparison is a count over validated coverage rows;
"invalidity search" — no venue or legal ground is involved.

**Examiner Baseline**:
The matrix of every document cited across a granted patent's **Patent Family**, by office and
by who cited it (examiner or applicant), with each examiner citation's **Relevance Category**
and cited claims. Computed by code from the offices' own records; the remainder "cited by no
office" is part of the Baseline. The starting point of Find Better and the "art of record"
section of an Invalidity Analysis.
_Avoid_: assembling it from chat prose or from one family member; reading an office with no
full-text coverage (CN/JP/KR) as "nothing cited" — it is a gap, shown as a gap.

**Search Statement**:
The editable Boolean query built from the concept-synonym table and the classification mapping
of a Prior-Art Search or Find Better run, in the field syntax of a target database, with a
one-click hand-off (copy, or open in Espacenet). The user may add, remove or edit concepts and
terms before running it; the working record keeps the version that ran.
_Avoid_: "the query" when several statements exist per run; shipping a statement without its
**Discriminating Term**.

## Application Drafting

**Application Drafting**:
The deliverable that turns a confirmed **Feature List** and **Approved Claims** into a **Draft
Application** (specification, abstract, brief description of the drawings) for one office (US
or EPO), with every sentence traced to a source, deterministic validators run as code, and a
human gate before each step (ADR 0012). Also the seventh **Project Type**. It drafts the text;
it does not draw figures and it does not file.
_Avoid_: "AI drafting" as a one-shot generator — the gates and the record are the feature;
"drafting" for claim-only work — that is the `claim-drafting` skill, which this deliverable
calls.

**Feature List**:
The attorney-confirmed inventory of the invention's elements, embodiments and figures that
drafting starts from. It is the contract between intake and drafting: a sentence in the draft
traces to a row here or to a disclosure span. Carries the attorney's `confirmed` flag; nothing
is drafted before it.
_Avoid_: letting the model extend the list during drafting — a missed feature is an
**Inventor Question**, never a silent addition.

**Approved Claims**:
The claims file for a draft after the attorney has set its `approved` flag. The specification
is generated against these claims and only after this flag exists. Editing the claims clears
the flag and starts a new draft version.
_Avoid_: "approved" said in chat — the flag is read from the file by code.

**Draft Application**:
The Markdown deliverable of Application Drafting: the specification in the chosen office's
section order, the abstract, the brief description of the drawings, each paragraph carrying
its source marker, and an **Inventor Questions** list at the end. Exported to .docx without
markers; its **Working Record** and findings stay beside it.
_Avoid_: calling the .docx the deliverable — it is the export; "Draft" as a Project Status.

**Model-Proposed**:
The source marker for text the model wrote in this draft without a source in the Feature List,
the disclosure, an attorney instruction or the office template. Allowed for structure
(transitions, boilerplate not in the template). Not allowed for technical content: a technical
gap becomes an **Inventor Question**.
_Avoid_: using it to hide filled technical gaps; counting template boilerplate as
Model-Proposed (that source is **Template**).

**Inventor Question**:
An open item the model raises when a claim element, example or embodiment has no source in the
disclosure. Listed at the end of the Draft Application and in the findings file. Export refuses
while one is unresolved and unwaived.
_Avoid_: resolving one by letting the model answer it; dropping one without a recorded waiver.

**Finding**:
One result of the draft validators or of the advisory review. An **Error** (antecedent basis,
dependency target, numbering, numeral mismatch, missing literal basis, office claim-form rule,
abstract length) blocks export until waived with a reason that is kept. A **Note** (claim count
over the fee threshold, relative terms present) never blocks. An **Advisory** item comes from
the model review, cites a passage, and never says "passed".
_Avoid_: an advisory item marked Error; a validator result without a line reference.
