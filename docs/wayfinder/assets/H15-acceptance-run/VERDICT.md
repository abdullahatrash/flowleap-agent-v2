# H15 acceptance head-to-head — verdict (2026-07-20)

**Result: destination NOT reached.** Post-fix main window vs bench (Claude harness), both on
`anthropic/claude-sonnet-5` via BYOK, 8-task corpus, blind-judged per task on Tool Strategy +
Execution Reliability. Main window won **2 of 8** (R2, R4) — short of the map's "win-or-tie on a
clear majority" bar.

## Conditions & integrity

- **bench** — headless `claude -p`, model `sonnet`→claude-sonnet-5, flowleap CLI 0.3.5 + skills,
  fresh scratch dir + detached stdin per task. 8/8 exit 0.
- **main** — main-window Patent AI agent (post-fix tree: H5–H10), model
  `anthropic/claude-sonnet-5` (OpenRouter BYOK), question carousels = default, tools = allow,
  no time cap.
- **Backend:** production `api.flowleap.co` WITH F1–F3 deployed (PR #149). EPO search verified
  healthy before the run — no outage confound this time (unlike H1's S1/S2/R4).
- **Integrity:** all 16 transcripts passed — exact prompt present, correct modelId
  (claude-sonnet-5 both sides), no cross-task contamination, bench exit 0.
- **Blinding caveat:** the two stacks are identifiable by tool names (CLI verbs vs typed IDE
  tools), so A/B anonymization enforced evidence-based scoring but could not hide identity.
  Judges scored on cited trajectory evidence, not on brand.

## Per-task (OVERALL, decoded)

| Task | Winner | Why |
|---|---|---|
| S1 obscure prior art | bench | main had the cleaner search (CPC pivot) but its #5 patent + a "family member" traced to no tool result; bench grounded its top pick in retrieved claims |
| S2 coined term | bench | strategy tied; main reached an equal answer in 82 calls (redundant single-term searches, duplicate summaries) vs bench's 23 |
| S3 X-citations chain | bench | both correct on all 3 sub-questions; main thrashed 43 calls + local grep detours to the same result bench got cleanly in 12 |
| S4 DeepMind continuity | bench | main ran continuity on the WRONG application, delivered no results table and no chain — offered to verify instead |
| R1 US claims verbatim | bench | task demanded full claim text; main paraphrased/mirrored ~15 of 20 claims; bench OCR'd the USPTO PDF and delivered all 20 traceably |
| **R2 nonexistent patent** | **main** | cross-verified nonexistence on a 2nd route + web and nailed the numbering-implausibility insight while staying bounded; bench's null was fine but thinner |
| R3 222KB description | bench | main paged only 3 chunks (some specifics untraceable); bench saved-to-file + paged ~10 offsets across the full text |
| **R4 analytics grind** | **main** | main answered all 3 sub-questions with traceable numbers; bench diagnosed the citation-coverage gap rigorously but ABANDONED part 3 — penalized under a rubric that docks admitting inability |

**Tally: bench 6, main 2.**

## What this means — the gap transformed, it didn't close

The original H1 failure class is **gone**: across all 8 post-fix runs there were **zero
give-ups, zero error-deaths, zero "consult a commercial database" deflections**. The persistence
ladder (H5), skill branches (H6), citation routing (H7), transient-error shape (H8), truncation
offload (H9 — visibly delivered US claims on R1), and Sonnet-5 default (H10) all did their job:
the main window now persists, recovers from errors, and reaches fallbacks.

The judges penalized a **new, milder class** of problems:

1. **Over-grinding** (S2 82 calls, S3 43 calls, R4 ~40 futile forward-citation calls *after* the
   guide had confirmed the route returns 0). The persistence ladder overshoots — it keeps
   hammering a route already proven dead instead of stopping. → [[H16]]
2. **Answer-grounding / fabrication risk** (S1 #5 patent, R1 paraphrased claims, R4 citation
   counts on a single suspect fetch): the main window several times asserted patent numbers or
   text not traceable to a tool result. → [[H17]]
3. **Verbatim-completeness shortcut** (R1): "full text of the claims" was answered with a
   paraphrase/mirror of most claims. → [[H18]]
4. **Target selection** (S4): when a sub-task needed "the most relevant" application, the agent
   operated on a different one. → [[H19]]

This is a strictly better problem than "quits early." It's specific, prompt-surface-shaped, and
none of it involves the systemic give-up deficit the map set out to close.

## Note

R4 is a main "win" the judge itself flagged as fabrication-risk (citation counts rest on one
`fetch_webpage` the bench's parallel run suggests isn't reliably fetchable). So even main's wins
carry the over-claiming signal that H17 targets — the 2-of-8 is if anything generous.
