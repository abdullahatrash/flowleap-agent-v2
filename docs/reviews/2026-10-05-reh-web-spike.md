# `reh-web` build and boot spike (PRD 0019 H1, issue #506)

Date: 2026-10-05. Base: `main` at `7f93ec2cd56`. Spec: ADR 0011, CONTEXT.md → **Hosted Workspace**.

## Verdict

**Both chat surfaces run in the web client, after four build fixes.** The workbench loads with the
FlowLeap brand. The Patent Agent extension activates on the server extension host. The agent host
starts on the server and registers the Claude provider. Two things did not complete, and both are
findings, not build breaks:

- **FlowLeap sign-in cannot finish in the browser.** The website returns the token to the
  `flowleap://flowleap.patent-ai/callback` deep link. A browser tab cannot receive that link.
- **No Agent Session answered.** The host had no `ANTHROPIC_API_KEY`, so the container had none.
  The Claude harness shows "No models available" (the expected no-account state).

The `main` build does **not** produce a working reh-web package. Without the fixes, the server
extension host crashes three times and the agent host cannot start.

## Build

CI has never built this target. The task names come from `build/gulpfile.reh.ts`
(`vscode-${type}-${platform}-${arch}[-min][-ci]`, type `reh-web`).

The one-shot task `vscode-reh-web-linux-x64-min` failed (see fix 1). The sequence that worked, on
macOS arm64, Node 24.15.0, from a worktree:

```sh
G="node --experimental-strip-types --max-old-space-size=16384 ./node_modules/gulp/bin/gulp.js"
$G compile-build-without-mangling
$G compile-extension:pdf-preview
$G compile-extension:flowleap
$G compile-extension:docx-viewer
$G compile-extensions-build
$G compile-copilot-extension-build
$G compile-extension-media-build
$G minify-vscode-reh-web
$G vscode-reh-web-linux-x64-min-ci
```

Output: `../vscode-reh-web-linux-x64` (sibling of the repo root, 748 MB). Total time is about
15 minutes; the compile step is about 6.5 minutes.

### Linux native modules (cross-build from macOS)

The package task copies `remote/node_modules` from the build machine. On a Mac those are Mach-O
binaries (`node-pty`, `spdlog`, `sqlite3`, `kerberos`, `@parcel/watcher`, `native-watchdog`,
`deviceid`). For the spike, the server `node_modules` came from a Linux install, and replaced the
package's `node_modules`:

```sh
# remote/package.json + package-lock.json + .npmrc copied to ./remote-linux-x64
docker run --rm --platform linux/amd64 -v "$PWD/remote-linux-x64:/w" -w /w node:24-bookworm \
  bash -c "apt-get update -qq && apt-get install -y -qq libkrb5-dev && npm ci && \
           npm rebuild node-pty kerberos @vscode/spdlog @vscode/sqlite3 @vscode/native-watchdog @vscode/deviceid"
rm -rf vscode-reh-web-linux-x64/node_modules
cp -R remote-linux-x64/node_modules vscode-reh-web-linux-x64/node_modules
```

npm 11.19 (in `node:24-bookworm`) warns that install scripts need approval; the explicit
`npm rebuild` makes sure every `.node` file is an ELF x86-64 binary. On a Linux build machine
(CI or the VM) this step is not necessary: `npm ci` in `remote/` builds them natively.

The Claude agent SDK is not in the package (upstream downloads it at first use from
`product.agentSdks`, and the reh gulpfile stamps that only for type `reh`). For the spike, the
pinned SDK was installed from `build/agent-sdk/agents/claude` with `npm ci` in the same
`linux/amd64` image and given to the server through `VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT`.

## Fixes made (every one)

| # | Break | Fix | Kind |
|---|-------|-----|------|
| 1 | `compile-build-with-mangling` (used by every `-min` task) fails: "Protected fields have been made PUBLIC" — test files and `sessionChangesEditor.ts` reach protected members. | Not fixed. Used `compile-build-without-mangling` (the same compile the macOS desktop release uses) and then the `-min-ci` package task. | Workaround in the command |
| 2 | Gulp's TypeScript reports 9 `implicitly has type 'any'` errors in three **test** files (tsgo accepts them). | Explicit type annotations in `codexProviderConfiguration.test.ts`, `agentFinderRestProvider.test.ts`, `extHostNotebookStatusCommands.test.ts`. | Real fix, test-only |
| 3 | Gulp OOM at the 8 GB heap from `npm run gulp`. | Ran gulp with `--max-old-space-size=16384`. | Workaround in the command |
| 4 | `compile-extensions-build` fails with `EISDIR` on symlinked `extensions/*/node_modules`. | Replaced the worktree symlinks with APFS clones (`cp -cR`). | Worktree-only, not in the diff |
| 5 | Server extension host exits 3 times: `Named export 'createProxyAuthorizationLookup' not found` from `@vscode/proxy-agent`. PRD 0017 moved the root `package.json` to the 1.140 versions but not `remote/package.json` (0.42.0 vs 0.45.0). | Aligned `remote/package.json` with the root versions of `@vscode/proxy-agent`, `@github/copilot-sdk`, `@microsoft/mxc-sdk`, `@vscode/copilot-api`, `tar`, `tas-client`, `zod`; regenerated `remote/package-lock.json`. | Real fix — affects every reh build |
| 6 | Agent host: `Cannot find module …/out/vs/platform/agentHost/node/agentHostMain.js`. #74 removed `agentHostMain` and `diffWorkerMain` from the server entry points in `build/buildfile.ts` and `build/next/index.ts`; PRD 0018 did not put them back. | Restored the two server entry points (`codeServer`, `serverEntryPoints`). | Real fix |
| 7 | Minify fails: non-ASCII `•` in a regular expression in `copilotCustomizationCommandDisplay.ts` (now inside the bundle because of fix 6). | `•` escape. | Real fix |
| 8 | Agent host: `Cannot find package '@vscode/fs-copyfile'` — the root has it, `remote/package.json` does not. | Added `"@vscode/fs-copyfile": "2.0.0"` to `remote/package.json`. | Real fix |

**Not fixed, flagged:** #74 also removed `agentHostMain`/`diffWorkerMain` from the **desktop**
entry points (`workbenchDesktop` in `build/buildfile.ts`, `desktopEntryPoints` in
`build/next/index.ts`). The only local desktop package that has `agentHostMain.js` is dated
26 June, before #74. Check that a current desktop release package contains
`out/vs/platform/agentHost/node/agentHostMain.js`; if not, Agent Sessions cannot start in shipped
builds. The spike did not change the desktop entries.

## Boot

Docker Desktop 4.55 on an arm64 Mac; the `linux/amd64` container runs under emulation.

```sh
docker run -d --name fl-reh-web-spike --platform linux/amd64 -p 127.0.0.1:8000:8000 \
  -v "$PKG:/opt/flowleap-server:ro" \
  -v "$SDK:/opt/claude-sdk:ro" \
  -v "$PWD/start-server.sh:/start.sh:ro" \
  -e VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT=/opt/claude-sdk \
  ubuntu:24.04 /start.sh
```

`start-server.sh`:

```sh
apt-get update -qq
apt-get install -y -qq ca-certificates git libkrb5-3 libgssapi-krb5-2
mkdir -p /root/workspace
exec /opt/flowleap-server/bin/flowleap-server --host 0.0.0.0 --port 8000 \
  --without-connection-token --accept-server-license-terms /root/workspace
```

The server prints `Web UI available at http://localhost:8000`. Open
`http://localhost:8000/?folder=/root/workspace`. No `--agent-host-*` flag is needed: in the
default configuration the server starts the agent host lazily when the first window connects
(`serverServices.ts`, configuration 3).

`ANTHROPIC_API_KEY` was not set on the host, so the container did not get one.

## PASS results

| Criterion | Result | Evidence |
|-----------|--------|----------|
| (a) Workbench loads with the FlowLeap brand | **PASS.** Title "Flow Leap, AI patent agent", FlowLeap welcome page, "Search Prior Art…" entry. | `docs/media/reh-web-spike/02-workbench-loaded.jpg` (before fix 5: `01-workbench-exthost-crash.jpg`, "Remote Extension host terminated unexpectedly 3 times") |
| (b) Patent Agent extension activates on the server extension host | **PASS.** Server log: `ExtensionService#_doActivateExtension flowleap.patent-ai … activationEvent: 'onView:flowleap.promptLibrary'`. FlowLeap Settings sidebar (Account, AI Model, Privacy), "Ask FlowLeap…" status item and the Patent Analysis Agent chat show. The chat says "No AI model connected yet. Sign in … or add your AI model" — the correct state with no key. | `03-patent-agent-activated.jpg` |
| (c) FlowLeap sign-in from the browser | **FAIL (finding).** "FlowLeap: Sign In" opens a new browser tab at `https://www.flowleap.co/en/auth/flowleap?redirect_uri=flowleap%3A%2F%2Fflowleap.patent-ai%2Fcallback&state=…`. The website signs in (Clerk session already present) and shows "You're signed in — Open FlowLeap", a link to the `flowleap://` deep link that carries the token. A browser-hosted workspace cannot receive it: the browser hands it to whatever app owns `flowleap://` on the viewer's machine (the desktop app, or nothing). The server log stays at "Sign-in already in progress; awaiting the existing flow" until the timeout. I did not click "Open FlowLeap", because it would give the founder's token to the desktop app on this Mac. | `04-signin-website-returns-to-deep-link.jpg` |
| (d) Agent Session starts and answers once | **NOT RUN — no API key.** The agent host runs (`agenthost.log`: "Agent Host process started successfully", "Registering agent provider: claude", `[Claude] Native account check: setUp=false, provider=firstParty, tokenSource=none, apiKeySource=absent`, "Models refreshed (merged). Count: 0"). In the chat target picker, "Claude" is disabled with "No models available". | `05-agent-session-no-account.jpg`, `05b-agent-session-picker-zoom.png` |

## Console and server errors (after the fixes)

- Browser console: the Chrome tool captured no errors or warnings on a fresh load.
- Server extension host: one `PendingMigrationError: navigator is now a global in nodejs` from
  `extensions/copilot/dist/extension.js` at activation. It is the upstream shim warning; the
  extension still activates.
- Before the fixes: fix 5's `SyntaxError` (extension host, 6 times) and fix 6 / fix 8's
  `ERR_MODULE_NOT_FOUND` (agent host).
- Observation, not checked further: the editor tab `invalidity-analysis.prompt.md` (opened by the
  prompt library at startup) renders blank.

## What H2 (hosted VM install script) must know

1. **Build on Linux x64, not on a Mac.** `npm ci` in `remote/` on the target OS gives the right
   native modules. A cross-build from macOS ships Mach-O `.node` files that fail on Linux.
2. **Use the non-mangled compile.** `vscode-reh-web-linux-x64-min` fails in the mangler. Run
   `compile-build-without-mangling`, the extension tasks above, `minify-vscode-reh-web`, then
   `vscode-reh-web-linux-x64-min-ci`. Give gulp a 16 GB heap.
3. **This PR's fixes are required:** server agent host entry points, `remote/package.json`
   aligned to the 1.140 root versions, `@vscode/fs-copyfile` in `remote/`.
4. **Claude SDK:** the reh gulpfile stamps `product.agentSdks` only for type `reh`, and upstream's
   comment says reh-web has no consumer — that is wrong for a Hosted Workspace. Either stamp
   `agentSdks` for reh-web too (`AGENT_SDK_RESULTS_FILE`, linux-x64 tarball from
   `build/flowleap/produce-claude-sdk.ts`) or install the pinned SDK on the VM and set
   `VSCODE_AGENT_HOST_CLAUDE_SDK_ROOT`.
5. **Model Path env:** put `ANTHROPIC_API_KEY` in the server process environment (systemd unit).
   The agent host reads it as `apiKeySource`.
6. **Runtime packages on Ubuntu 24.04:** `ca-certificates git libkrb5-3 libgssapi-krb5-2`. The
   package carries its own Node (24.15.0).
7. **Server command:** `bin/flowleap-server --host 127.0.0.1 --port 8000
   --accept-server-license-terms <workspace>` behind nginx. Do not use
   `--without-connection-token` on a reachable host unless the Clerk gate is in front.
8. **Sign-in needs a web callback.** The `flowleap://` deep link cannot reach a browser client.
   H-series work needs a web redirect URI (for example `https://<workspace host>/callback` routed
   to the extension through `vscode.env.asExternalUri`), and the backend allow-list must accept
   it. Until then, a Hosted Workspace user cannot sign in, so the trial key is not provisioned
   and the editor chat has only BYOK.
9. Workspace trust: two loads showed Restricted Mode; later loads did not, and I did not grant
   trust (cause not checked). The install script should pre-trust the workspace folder or set
   `security.workspace.trust.enabled` for the instance.
