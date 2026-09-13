# PRD 0014 — Prompt Library in the FlowLeap sidebar

Status: proposed, 2026-09-13. Owner decision recorded: copy only, no insert-into-chat.

## Problem

Users re-type the same long prompts for every task (the prior-art demo prompt is typed
for every run). The app already ships reusable prompt files and 26 slash-command skills,
but the only way to find them is to type `/` in the chat input or open the Agent
Customizations editor. Nothing in the sidebar shows a user what to ask for.

## Goal

A **Prompts** view in the FlowLeap sidebar, next to Projects and Setup, that lists
bundled FlowLeap prompts and the user's own prompts, with one-click **Copy** and a
simple **Add** flow. No chat-widget integration.

## Non-goals

- Inserting into or sending to the chat input (owner decision).
- A new storage service or sync. Prompts are files.
- Editing bundled prompts in place.
- Replacing the Agent Customizations editor.

## Design

### Placement
A tree view `flowleap.promptLibrary` contributed by `extensions/copilot` into the
existing `flowleap-sidebar` container (owned by `extensions/flowleap`), the same way
`flowleap.setupView` is injected today. Order: Projects, Prompts, Setup.

### Sources
1. **FlowLeap prompts** (read-only): new `.prompt.md` files under
   `extensions/copilot/assets/prompts/flowleap/`, also contributed through
   `contributes.chatPromptFiles` so each one doubles as a `/name` slash command.
2. **My prompts** (user-authored): `.prompt.md` files in
   `<globalStorageUri>/prompt-library/`. Extension-owned, survives updates, per user.

Both use the standard prompt-file front matter (`name`, `description`) followed by the
prompt body. The body is what Copy puts on the clipboard.

### Tree
```
Prompts                                   [+ Add] [↻]
├─ FlowLeap
│  ├─ Prior-art search (IDF attached)      [Copy]
│  ├─ Claim analysis                        [Copy]
│  └─ …
└─ My prompts
   ├─ <user prompt>                         [Copy] [Edit] [Delete]
   └─ (empty state: "Add a prompt to reuse it later")
```
Item label = `name`; tooltip = `description` + first lines of the body. Copy shows a
brief "Copied" notification. The tree's built-in filter (type-to-find) covers search.

### Actions
| Action | Where | Behaviour |
|---|---|---|
| Copy | inline on every item; context menu | body to clipboard |
| Add | view title | quick input for the title → creates `<slug>.prompt.md` in My prompts with front matter and opens it in an editor; view refreshes on save |
| Edit | inline on My prompts | opens the file |
| Delete | context menu on My prompts | confirm, then delete |
| Refresh | view title | re-read both sources |
| Open file | double-click | opens the `.prompt.md` (bundled ones read-only) |

### Seed content (FlowLeap prompts)
One prompt per shipped recipe skill, phrased the way the owner runs them, each naming
the input to attach. First eight: prior-art search (the demo prompt verbatim), claim
analysis, freedom-to-operate, patent landscape, invalidity analysis, office-action
response, patent-to-report dossier, academic literature review.

### Gating
Visible when `patentIdeMode` is true (same as the other FlowLeap views).

## Acceptance
- The view shows both groups on a fresh profile; the FlowLeap group lists the seed
  prompts; My prompts shows the empty state.
- Copy on any item puts exactly the prompt body on the clipboard.
- Add creates a file, opens it, and the item appears after save; Delete removes it.
- Each FlowLeap prompt is also available as `/name` in chat.
- Unit tests: front-matter parsing, tree ordering, empty state, slug collisions.
- Live check: on a rebuilt app, copy the prior-art prompt from the view, paste into
  chat with the IDF attached, run; the report matches the demo baseline.

## Out of scope for v1, noted
Workspace-scoped prompts (`.github/prompts`), import from the profile prompts folder,
sharing prompts between users, categories beyond the two groups.
