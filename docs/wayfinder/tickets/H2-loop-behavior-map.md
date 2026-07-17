---
id: H2
title: Map the main-window agent loop vs the Claude Code loop (retry, errors, limits)
type: research
status: closed
assignee: abdullahatrash
blocked-by: []
---

## Question

What does our fork's main-window agent loop actually do — in code — when a tool call
errors, returns empty, or truncates, and how does that compare to the Claude Code
harness loop the agents window runs on?

### Scope

Codebase research in `flowleap-agent-v2` (copilot 0.55 base):

- **The loop:** iteration limits, stop conditions, what ends a turn early, how
  continuation is decided after a tool result.
- **Tool error surfaces:** what a thrown/failed typed patent tool actually sends back to
  the model (raw stack? typed error? localized message?) — and whether the shape invites
  retry or reads like a dead end. Include the `IPatentBackendClient` 401/402 paths and
  empty-result payloads.
- **Truncation:** where tool results get clipped (token budgets, result caps) and what
  the model sees when they are.
- **Prompt-side instructions:** what the patent system prompt + skills tell the model to
  do on failure/empty results, if anything.
- **Contrast column:** the equivalent behaviors in the Claude Code harness (public docs +
  the agents-window integration in our tree) — retry affordances, error verbosity,
  loop persistence.

### Resolution records

A markdown asset mapping each behavior side-by-side with file:line references, flagging
the mechanical divergences most likely to explain give-up-early / die-on-error behavior.
Feeds [Root-cause attribution](H3-root-cause-attribution.md).

## Resolution (2026-07-17)

Full side-by-side map with file:line references:
**[assets/H2-loop-behavior-map.md](../assets/H2-loop-behavior-map.md)**

Answer in brief — **the loop skeleton is not the divergence**:

- Both loops return tool errors to the model as tool results and keep going; neither
  aborts a turn on a thrown tool. The main window allows 200 tool-call rounds by default
  (then a "Continue to iterate?" card, not a silent stop); the Claude harness sets no
  turn cap at all (fork never passes `maxTurns`).
- The mechanical divergences most likely to explain the gap, ranked for H3:
  1. **Transient model-fetch failures end the main-window turn** (auto-retry exists only
     in autopilot modes) while the Claude CLI retries API errors internally — prime
     die-on-error candidate.
  2. **Dead-end zero-hit strings on `search_patents`/`search_academic`** ("No patents
     found for query: …", no nudge) combined with **no zero-result or search-error rule
     anywhere in the prompt or the 25 skills** — prime give-up-early candidate.
  3. **Generic backend errors carry no recovery hint** (raw truncated body / bare
     `Error: <msg>`), unlike the typed 401/402/429 paths which do.
  4. **Prompt co-endorses stop-and-disclose with retry** ("say so and offer to search")
     with only the generic base persistence line.
  5. **Skill packs differ across surfaces**: bundled patent skills are deliberately
     filtered out of Claude sessions (they name panel-only typed tools), so the
     benchmark runs the CLI skill pack — part of the gap may be skill wording.
  6. Silent field clips (legal/academic tools), autopilot-only bail heuristics, subagent
     forced-emit-when-empty, and the jurisdiction-gate pause round out the list.
- Explicitly ruled out as divergences: turn-abort-on-tool-error, marked harness-side
  truncation, loop-level history handling.
