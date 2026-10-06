# Hosted Workspace: FlowLeap runs its own server build per user for browser access

**Status:** accepted (2026-10-05)

We want to put FlowLeap in front of people who will not or cannot install a desktop app and
have no AI vendor account: an invited evaluator first, hosted customers later. ADR 0009 planned
browser access only as a **Viewer** that follows a desktop **Host** through the **Relay**, which
needs an awake machine owned by that user and cannot start sessions. The fork still carries
upstream's server build (`vscode-reh-web`): the whole app runs on a server, the browser draws it,
the extension host and the agent host run server-side, and the Claude agent in native mode
inherits the server's environment. We decide to operate that build, one instance per user, as the
**Hosted Workspace**.

## The decisions

1. **A Hosted Workspace is the fork's own `reh-web` build, run by FlowLeap, one instance per
   user.** Both chat surfaces work unchanged: Agent Sessions through the agent host, and the
   editor Patent Agent chat through the server-side extension host, with the same skills, tools,
   files and working records as the desktop. Rejected: a FlowLeap-run Host behind the Relay (a
   second-hand route to the same server build, minus session creation); a separate web chat page
   (a third chat surface to keep in step, without files or skills); the Viewer for keyless users
   (it follows, it does not run).
2. **One isolated environment per user, carrying no backend secrets.** A browser user gets a
   terminal and a file system, so each user has their own VM or container. A Hosted Workspace is
   a client of `api.flowleap.co` like any desktop: it authenticates with that user's **FlowLeap
   Session** and holds no database, Valkey, Clerk or provider credentials of the backend. The
   first instances are hand-made VMs; a spawner in the backend comes only when there are more
   users than hands.
3. **The Model Path on a Hosted Workspace runs on the server.** Agent Sessions use a
   FlowLeap-owned Anthropic **API key**, with a spend cap set at the provider. The key is not in
   the server's process environment: the pty host and the agent host are children of the server,
   so a key there prints with `echo $ANTHROPIC_API_KEY` in the browser terminal and works
   anywhere once copied. A key-injecting proxy on `127.0.0.1`, run as its own user from its own
   root-only environment file, adds the real `x-api-key`; the server gets only
   `ANTHROPIC_BASE_URL` (the proxy) and a dummy `ANTHROPIC_API_KEY`. A hosted user can still
   spend through the proxy from inside their instance, which the spend cap bounds; they cannot
   take the key away. This is the decision ADR 0009 decision 2 left open, for the Hosted
   Workspace only: the desktop keeps the native path. Teardown revokes the key regardless. A claude.ai consumer login is never used to serve a third party. The editor chat
   runs on the trial-provisioned key or the user's own BYOK key, stored in that instance's secret
   storage, exactly as on a desktop. This is a Model Path variant, not an addition to the backend's
   **FlowLeap-Managed Inference** list: the hosted user has already placed their files and chats
   on a FlowLeap machine, so the confidentiality argument of backend ADR 0012 is settled by the
   choice of tier, and must be stated in the data-handling page before any hosted user signs in.
4. **Access is a FlowLeap Session in front of the instance, allowlisted.** nginx with HTTPS and
   the Clerk sign-in gate; v1 admits named invitees only. Whether Hosted Workspaces become a Pro
   entitlement with a usage cap is a later product decision and needs its own ADR.
5. **Remote Access (ADR 0009) keeps its scope and loses its priority.** The Viewer stays the
   answer for a desktop user who wants their phone to follow their Mac. It is no longer on the
   path to browser access for new users.

## Consequences

- The `reh-web` target has never been built by the fork's CI. The first slice is a build and
  boot spike on a throwaway VM; what upstream's web client lost in the PRD 0017 keep-outs is
  found there, before anyone is given a date.
- FlowLeap pays inference for hosted users. The spend cap is the only brake in v1.
- Positioning moves from "local and BYOK" to "local, or hosted by FlowLeap"; the data-handling
  page gains a hosted section; the website gets a sign-in path to a user's workspace.
- Security surface: a signed-in hosted user can run anything inside their instance. Isolation is
  the control; nothing else on that instance may be worth taking.
- **Amended 2026-10-06 (#547): the user's data lives on the instance, not in the browser.**
  Upstream's web client keeps settings, browser state and secrets in the browser's IndexedDB
  (and secrets only in memory when a remote has no key cookie, so they were lost on every
  reload). On a Hosted Workspace that meant a cleared or blocked site-data store started from
  zero, and two browsers saw two states. The server flag `--hosted-user-data` (set by
  `install.sh`) makes the web client keep user data in the server's data folder through the
  remote file system, browser state in JSON files there, and secrets in one AES-GCM file whose
  key is split between the file and a server-issued key in `/etc/flowleap`. Desktop and web
  without the flag are unchanged. The encryption protects a copy of the data folder, not a
  running instance: its user can read both halves of the key, which is consistent with
  isolation being the control.
