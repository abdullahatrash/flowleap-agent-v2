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

**Workspace-Assistance Command**:
A lightweight, **user-typed slash command** that helps the user *operate the file-rich patent
project* — not analysis. Distinct from a Patent Skill (a command is a shortcut, not a deliverable).
_Avoid_: conflating with Patent Skill.

## Authentication & model path

**Model Path**:
How **inference** happens. FlowLeap is **BYOK** (ADR 0004 in the old setup): the LLM call runs
client-side through VS Code's native BYOK subsystem using the user's own provider key. There is
no inference proxy — the old backend chat proxy is retired (410).
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
subscription pays for — **not** inference (which is BYOK).
_Avoid_: "the LLM backend" — it serves patent data, never inference.

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

**Effective Filing Date** / **Priority Date**:
The date a Prior-Art Search is measured against: a document is prior art if it was publicly
available before the application's effective filing date. A reference's own **publication date**
decides whether it counts; its **earliest priority date** matters only for E-category secret prior
art. Prior-art status is **jurisdiction-dependent** (US has a 1-year inventor grace period; Europe
applies absolute novelty).
_Avoid_: conflating "publication date" with "priority date" — they answer different questions.
