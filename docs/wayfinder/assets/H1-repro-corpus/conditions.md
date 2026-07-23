# Run conditions (2026-07-17)

All three conditions ran the identical prompts from `corpus.md` against the deployed
backend `api.flowleap.co`, from the same machine, same day.

## bench — Claude harness + flowleap CLI + skills
- Headless `claude -p` (Claude Code CLI 2.1.212), model pinned `sonnet` → resolved
  **claude-sonnet-5**; fresh scratch cwd per task (outside any repo).
- flowleap CLI 0.3.5 on PATH, authenticated (API key); user-level flowleap skills
  available to the harness (same skill pack the agents window bundles).
- Allowed tools: `Bash(flowleap:*)`, `Bash(jq:*)`, `Bash(python3:*)`, WebSearch,
  WebFetch, Read, Glob, Grep, Write, TodoWrite, Skill. No permission prompts.
- Deviation from the literal agents window: runs are headless CLI sessions, not the
  Agents-window UI. Same harness, loop, and skills; UI chrome differs.
- Transcript: full stream-json (`transcript.jsonl` per task).

## main-usual — main-window Patent AI agent, as-found BYOK model
- Code OSS built from `main` (4a2328b7b1e), profile cloned from the user's authed dev
  profile (`~/Library/Application Support/code-oss-dev`).
- Model **as found selected in the user's profile**: `Anthropic: Claude Sonnet 4` via
  OpenRouter BYOK (`openrouter/OpenRouter-v4/anthropic/claude-sonnet-4`), Medium effort.
- Agent mode, typed patent tools + bundled skills; workspace "My First Investigation"
  trusted.
- Interaction policy (uniform): question carousels answered with the DEFAULT option;
  tool confirmations answered "Allow in this Session"; per-run cap 25 min.
- Transcript: chat session store JSONL (`session.jsonl` per task).

## main-claude5 — main-window Patent AI agent, same model as bench
- Identical setup to main-usual, but model registered+selected as
  `Anthropic: Claude Sonnet 5` via OpenRouter BYOK — the same Claude-class model the
  bench resolved to (served by OpenRouter rather than a first-party Anthropic key; no
  Anthropic API key was available on this machine).

## Transcript integrity checks (run before tallying)

Every capture was verified against its stored transcript, not against the driver's
claim of success:

- **Prompt match** — the run's own transcript must contain the exact task prompt.
- **Model match** — main-window sessions must record the condition's `modelId`
  (`anthropic/claude-sonnet-4` for main-usual, `anthropic/claude-sonnet-5` for
  main-claude5); bench transcripts must record `claude-sonnet-5`.
- **Cross-task contamination** — no transcript may contain another task's prompt.

Two problems this caught, both fixed by re-running:

1. **bench S2 (first attempt) was contaminated.** The batch runner fed tasks via a
   `while read` loop, and `claude -p` inherited that loop's stdin, swallowing the
   remaining task lines. The S2 process answered S2 + R1–R4 in one 219-tool-call
   session. Re-run in isolation with `< /dev/null`. (S1/S3/S4 were unaffected —
   verified prompt-clean.)
2. **main-claude5 model reverted.** Selecting a catalog model in the picker did not
   stick across new chats — chats reopened on Sonnet 4, which would have silently
   destroyed the model control. Fixed by making Sonnet 5 the profile default and
   re-verifying the recorded `modelId` in every capture.

Also worth knowing for anyone re-running this: the chat session store flushes lazily
and in bursts (one run jumped 15 KB → 294 KB in 100 s), so a static session file is
**not** evidence that a run is hung.

## Known asymmetries to keep in mind when grading
- The main window can block on questions/confirmations; the bench cannot ask (headless).
  Stall time is excluded from strategy grading; the *choice* to ask is still recorded.
- Bench had WebSearch/WebFetch (like the agents window harness); the main-window agent
  has its own fallback tools (`web_search` per prompt rules) — treat "found a legitimate
  non-backend fallback" as success on either side.
- S1 main-usual was driven semi-manually (driver was being calibrated): same policy,
  duration ~50 min wall including waiting-for-human stalls.
