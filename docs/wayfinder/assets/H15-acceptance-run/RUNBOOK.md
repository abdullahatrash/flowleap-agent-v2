# H15 acceptance run — runbook

Two conditions × 8 tasks. Prompts come **verbatim** from
[`../H1-repro-corpus/corpus.md`](../H1-repro-corpus/corpus.md) (S1–S4, R1–R4).
Transcripts land in `runs/<task>/{bench,main}/`.

## Before anything: scope + health

1. **Backend scope: RESOLVED** — F1–F3 merged (backend PR #149) and deployed to
   production 2026-07-20; deploy green, F1 live-verified (object-`q` → structured
   `400 invalid_query` on `api.flowleap.co`; healthy path confirmed via
   `flowleap uspto grant`). Both sides hit production; **no scope note needed**.
   (F2/F3 are outage-path behaviors — not directly probeable in clear weather.)
2. **EPO health check** — before each batch of tasks (and re-check if a run smells
   like an outage): one cheap live search via the CLI, e.g.
   `flowleap patent search 'ti="wireless power"' --limit 1`
   (see `../H1-repro-corpus/probes.md` for the deeper probes). If it times out or
   5xxes, WAIT — do not burn corpus tasks during an outage; that is exactly what
   invalidated S1/S2/R4 in H1.

## Condition A — bench (headless, ~minutes each, can run first)

Per task, fresh scratch dir outside any repo, stdin detached (H1 lesson: a `while read`
batch loop contaminates stdin — run tasks one at a time or always `< /dev/null`):

```bash
D=$(mktemp -d) && cd "$D"
claude -p "<TASK PROMPT VERBATIM>" \
  --model sonnet \
  --allowedTools "Bash(flowleap:*),Bash(jq:*),Bash(python3:*),WebSearch,WebFetch,Read,Glob,Grep,Write,TodoWrite,Skill" \
  --output-format stream-json --verbose \
  < /dev/null > transcript.jsonl 2>stderr.log
```

Copy each `transcript.jsonl` to `runs/<task>/bench/`. flowleap CLI must be on PATH and
authenticated (`flowleap auth status`).

## Condition B — main window, post-fix (interactive, you drive)

1. **Build & launch from the current tree** (fixes are in source, so the running build
   must be fresh): launch VS Code from sources with `TMPDIR=/tmp` (socket-path gotcha);
   trust the workspace. A stale build silently tests the OLD prompt/tools — if in doubt,
   rebuild/restart fully (prompt + package.json changes do not hot-reload).
2. **Model**: pick `Anthropic: Claude Sonnet 5` (OpenRouter BYOK) in the model picker.
   Do this **per new chat** unless the profile default is set — H1 caught silent
   reversion to a weaker model; the recorded modelId is verified post-hoc either way.
3. **Per task**: NEW chat → paste the task prompt verbatim → interaction policy:
   answer question carousels with the DEFAULT option; tool confirmations
   "Allow in this Session"; **no time cap** — let it grind to completion.
   Note the wall-clock roughly, and run tasks IN ORDER (S1→S4, R1→R4) so the session
   files map to tasks unambiguously.
4. Do not export anything — the chat session store JSONLs are harvested from the
   profile afterward (lazy flush: a static file is not a hung run; done = stop button
   gone + file mtime idle).

## Handoff

When all 16 runs are done, say so (and mention any anomaly: outage suspicion, a chat
you re-ran, a wrong-model chat). Post-run processing (not yours): harvest session
JSONLs, integrity checks (prompt/model/contamination), structural tally per the H1
rubric, anonymized A/B judging on tool strategy + execution reliability, verdict on
the map.
