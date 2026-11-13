# PRD 0027 PR B — ground rules for every re-apply group

You re-apply this fork's own changes ("intents") on top of upstream microsoft/vscode 1.146.0 source that was just copied wholesale. The fork is "FlowLeap Patent AI": a VS Code fork whose only agent in the Agents Window is Claude through upstream's agent host, with FlowLeap sign-in instead of GitHub, Copilot/Codex/GitHub surfaces kept out, patent-specific tools, prompts and skills, and a Remote Access feature (Host/Relay/Viewer). `extensions/copilot` is the fork's own editor chat (BYOK providers, patent tools) and is NOT part of this sync.

## Where things are
- Your worktree: given in your task. It is checked out at the checkpoint commit `port(0027-B): step 10-13` on your own branch `port/1146-<group>`. `pnpm install --frozen-lockfile` has been run; Node 24.22.1 + pnpm 12.16.0 are on PATH as `$HOME/.nvm/versions/node/v24.22.1/bin` (prefix PATH yourself in every shell command).
- Upstream reference: `/Users/abdullahatrash/flowleap/refrence/vscode` (note the spelling). Read files with `git -C <ref> show 1.146.0:<path>`; never check out anything there.
- The fork BEFORE this sync (what the intents looked like on 1.140): commit `1feddc94420` in your worktree's history. `git show 1feddc94420:<path>` gives the old file; `git show <hash>` gives a fork commit; `git log --format='%h %s' 45a4c6d6ddc..1feddc94420 -- <path>` lists the fork commits on a path since the previous sync.
- The replay kit: `build/upstream-sync/1.146/`. `patches/*.patch` are the 1.140-era patches (written against upstream 1.140.0); `notes/notes-{aw,onb,chat,brand}.md` describe each intent (A*, B*) independent of code; `lib/apply-patch.sh <worktree> <patch>` applies a patch idempotently; `lib/save-patch.sh <worktree> <script-name> <path>...` saves your uncommitted changes under those paths as `patches/<script-name>.patch` + a runner script.
- The 1.140 → 1.146 survey (what upstream changed, which seams moved, which patches apply): `docs/reviews/2026-11-13-upstream-survey-1.140-to-1.146.md` plus `-agenthost-sessions.md` and `-chat-byok-build.md` next to it. Read your group's sections before touching code.

## Method, per intent
1. Try the 1.140 patch first: `build/upstream-sync/1.146/lib/apply-patch.sh <worktree> build/upstream-sync/1.146/patches/<name>.patch`. If it applies, check the result still makes sense on 1.146 (the seam may have moved semantically even when the text matched).
2. If it does not apply: read the note for that intent and the old fork hunk (`git show 1feddc94420:<file>` vs `git show 1.146.0:<file>` in the reference), find the new seam in upstream's 1.146 code, and re-implement the intent there with the smallest change. Never paste old fork code over upstream's rewrite. When upstream now has a mechanism for the same intent, use upstream's and record "subsumed".
3. Drop an intent only when the survey or your reading shows upstream subsumed it or the surface is gone; say so in your report.
4. After each intent: `git add -- <its files>` and `git commit -- <its files>` with the subject `port(0027-B): <id> — <intent>` (e.g. `port(0027-B): A2 — Claude-only session type picker`). Commit per intent, explicit paths, never `git add -A`, never `git commit -a`. The pre-commit hygiene hook runs eslint on your staged files; fix what it reports (do not bypass it).
5. Then save the kit patch for it from the committed diff: `git diff HEAD~1 HEAD --binary -- <paths> > build/upstream-sync/1.146/patches/<script-name>.patch` and write the runner script the way `lib/save-patch.sh` does (copy an existing `30-reapply-*.sh` and change the name). Keep the 1.140 numbering where the intent is the same (`30-reapply-01-A2-...`), add new numbers for new intents (see your task). Commit the kit files for that intent in a second commit `port(0027-B): kit — <id>`.
6. Keep notes: append what you did per intent to `build/upstream-sync/1.146/notes/notes-<group>.md` (one paragraph each: seam at 1.146, what changed vs the 1.140 patch, subsumed/dropped and why). Commit it at the end.

## Gates before you report
- `node node_modules/@typescript/native/bin/tsc --noEmit -p src/tsconfig.json` (that binary is tsgo): report the total error count and paste every remaining error inside your owned paths. Errors outside your paths belong to other groups; list them but do not fix them.
- `pnpm run valid-layers-check` must not add new layer violations in your files.
- `pnpm exec eslint <your touched files>` clean.
- Do not run the unit suite or launch the app; the lead integrates the four groups and does that.

## Ownership (do not edit files outside your paths; if an intent needs a change in another group's file, describe the exact change in your report instead)
See your task. Shared entry points are owned by the `aw` group: `src/vs/workbench/workbench.{common,desktop,web}.main.ts`, `src/vs/sessions/sessions.{common,desktop,web,viewer}.main.ts`, `src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts`. Other groups that need a registration line there put the exact line(s) in their report under "Registrations for aw".

## Keep-out doctrine
Unregister, never delete: upstream code stays, the fork does not register the contribution/service/action. Product-level switches go into code registration defaults, not product.json (configurationDefaults in product.json are inert on desktop).

## Report (under 150 lines)
Table: intent → applied as-is / re-anchored / re-derived / subsumed / dropped, with the kit script name. Then: remaining tsgo errors in your paths (should be none), "Registrations for aw" lines, and anything you could not resolve with the reason.
