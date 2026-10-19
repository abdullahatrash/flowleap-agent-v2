# Full-stack run on the laptop

Run a backend branch and an app branch together on one machine, drive the app the way an
attorney does, and keep the evidence. This is the bar a PR meets before it leaves draft while
there is no staging environment: nothing goes to a main branch until both sides ran together.

Two terminals, one window. Everything here is on `main` except the two branches under test.

## Terminal 1: the backend on port 8000

```bash
cd ~/flowleap/flowleap-backend
git fetch origin
git worktree add ../wt-<name> origin/<backend-branch>        # skip when it exists
cd ../wt-<name>
ln -s ~/flowleap/flowleap-backend/node_modules node_modules   # once; the backend needs one link
cp ~/flowleap/flowleap-backend/.env .env                      # .env is not in git
grep -E "^(PORT|DATABASE_URL|REDIS_URL)=" .env
```

Read those three lines before you start. `PORT` is 8000. `DATABASE_URL` and `REDIS_URL` point at
your local Postgres and Valkey, never at production. Then:

```bash
npm run dev
```

Leave it running. In another shell, `curl -s http://localhost:8000/health` answers.

## Terminal 2: the app from its worktree

```bash
cd ~/flowleap/flowleap-agent-v2
git fetch origin
git worktree add ../wt-<name> origin/<app-branch>             # skip when it exists
scripts/worktree-setup.sh ../wt-<name>
cd ../wt-<name>
```

The setup script links every dependency tree from the main checkout and builds. It ends with
`worktree ready`. Then point the app at your backend and launch it through the verify harness:

```bash
export PATENT_API_URL=http://localhost:8000/v1
C=.claude/skills/verify-flowleap-ide/scripts/control-flowleap-ide
$C up --unattended
$C doctor
```

`up` prints one JSON line with `runId` and `evidenceDir`. `doctor` must say `"ok":true`. Keep the
`/v1` on the URL: the app strips it to build the base address. `--unattended` seeds the throwaway
profile so no tool, URL or request-limit prompt stops a long run.

## In the window: the one manual step

1. Close the onboarding dialog.
2. Open FlowLeap Settings in the Activity Bar, choose Add AI Model, paste your key. The profile
   is throwaway; the key dies with it at teardown.
3. Open Chat and run the prompts the PR is about. Read the first turn, the tool calls and the
   result text the PR changed, not only the final answer.

## Evidence, then teardown

```bash
EV=$(ls -td .claude/skills/verify-flowleap-ide/artifacts/vfl-* | head -1)
$C screenshot --path "$EV/<feature>-01.png"
$C inspect snapshot --path "$EV/<feature>-01.aria.yml"
$C inspect log 30
$C down
```

`down` kills the app and keeps `$EV`. Attach the folder, or its screenshots, to the PR. Stop the
backend with Ctrl+C in terminal 1. Remove the worktrees when the PR is merged:

```bash
git worktree remove ../wt-<name>
```

## When a step fails

- `doctor` is not ok: do not drive it. Run `$C down`, read `firstFailed`, rerun the setup script.
  A missing build file is the usual cause.
- The app calls production: `PATENT_API_URL` was not exported in the same shell as `up`.
- Backend 401 or 402: the FlowLeap session is on production. Sign in from the FlowLeap Settings
  page in that window.
- Two promptfoo runs at once corrupt each other's results: run one eval suite at a time.

## Known limits of a linked worktree

About 26 spec files that load tree-sitter or WASM grammars fail through the linked
`node_modules` and pass in a real checkout. The husky pre-commit hook cannot run in a worktree;
commit with `--no-verify` and check the hygiene rules by hand. Both are listed in the header of
`scripts/worktree-setup.sh`.
