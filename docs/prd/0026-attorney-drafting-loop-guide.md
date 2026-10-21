# PRD 0026: The attorney's map of the drafting loop

**Status:** READY 2026-10-19. Follows PRD 0022 (drafting), PRD 0023 (drawings) and PRD 0025 (gate actions).
**Owner:** founder. The words an attorney reads are the founder's; agents structure, never publish.

## Problem

Drafting an application with drawings is not one chat turn. It is a loop over days: disclosure, Feature List, claims, draft, findings, figures, renders in review cycles, the drawing set, export. The D7 run of 2026-10-19 (docs/reviews/2026-10-19-drawings-d7-acceptance-pipe-clamp.md) showed that the agent knows the steps and the attorney does not know the shape of the loop. Every question the founder asked that day was an orientation question: what to paste first, same chat or a new one, what to do when the agent stops with options, why the checklist still says 11 open.

PRD 0025 removed the need to learn commands. This PRD removes the need to learn the loop.

## Principle

One source of truth, three surfaces. The loop is written once. `checklist.md` carries it inside the matter, the agent says it at each transition, and one page in the Prompts view says it before the first matter. No onboarding tour, no course, no second place that lists the steps.

## Slices

### S1 Checklist header and reveal at start

- `checklist.md` opens with a block of at most six lines: the loop in order, and what re-opens what (a claim change re-opens the approval; a figures.md change re-runs coverage; a new render of a drawn Figure needs a new review cycle; a waived Error stays waived until the file changes).
- The block ends with one line that names the Prompts view page of S3.
- `start_application_draft` reveals `checklist.md` beside the chat on the first call of a matter, not only after a later tool call.
- Code writes the header, like the rest of the file. Tests: the header text in the checklist snapshot; the reveal on the first call.

### S2 The agent speaks at the transitions

- At every gate change and step end, the drafting and drawings tools end their result with one line in this shape: what just happened, what the attorney does next, and whether to stay in this chat. Today the line names the next file and line (PRD 0025 S3); this slice adds the chat advice.
- Rule for the chat advice, written in code, not in the model: stay in the same chat for one matter; start a new chat after an app restart or a rebuild, and when the agent has refused the same thing twice (it anchors on its own refusals, seen 2026-10-16).
- No new tool, no new prompt text for the model. Tests: the line on each tool result; the "new chat" variant after a repeated refusal.

### S3 One page in the Prompts view

- A new seed entry under `extensions/copilot/assets/prompts/flowleap/`, title "Drafting with drawings: the loop". Ten lines and one small diagram of the loop; the three things the attorney types and the three buttons the attorney clicks; when to start a new chat; where the checklist is.
- The agent delivers the structure and a proposed text in the PR. The founder rewrites the text before the PR leaves draft. The PR is not marked ready by an agent.
- The website copy is made from this file at release by the marketing routine; out of scope here.
- Tests: the entry is listed by the Prompts view spec like the other seeds; the skills-drift check stays green.

## Rules for the agent (every slice)

- Base `origin/main`; own worktree; draft PR to main; the founder merges.
- Simplified Technical English in every line an attorney reads: short sentences, one idea each, no frontmatter words, no flag names, no command names.
- The words "compliant" and "compliance" never appear.
- No change to the record formats, the gates, or the tools' schemas.

## Out of scope

An onboarding tour, a video, a tutorial matter, a settings page, website changes.

## Acceptance

One attorney who has not seen the product reads the Prompts page, opens a fresh matter, and reaches the drawing set with the checklist and the transition lines only, with no question to the founder about what to paste or which chat to use. Recorded under `docs/reviews/`.

## Outcome

(filled at completion)
