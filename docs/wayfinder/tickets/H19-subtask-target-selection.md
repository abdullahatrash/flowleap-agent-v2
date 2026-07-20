---
id: H19
title: Prompt — sub-task target selection: act on the item the answer names as most relevant
type: task
status: open
assignee:
blocked-by: []
---

## Question

On S4 ("find DeepMind protein-structure applications, and show the continuity chain of the most
relevant one") the main window ran `get_continuity` on a *different* application than the one its
own answer called most relevant, and delivered no chain. What rule keeps a multi-part task
coherent — when a follow-up sub-task references "the most relevant / top one", operate on the
specific item just selected, and actually deliver that sub-result rather than offering to?

### Evidence
[H15 VERDICT](../assets/H15-acceptance-run/VERDICT.md) task S4 (bench picked the AlphaFold
continuation and pulled its real chain). Smallest of the four follow-ups; likely a short prompt
clause about carrying the selected entity into the dependent step. Surface: `patentAIPrompt.tsx`.
