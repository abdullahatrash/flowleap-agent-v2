# Local development: backend + app on one Mac

Both repos run on this machine without touching production. Verified 2026-10-22 on main of both repos (backend after #606 merged; app at v0.9.1 + #855).

## Ports and env vars

| What | Value |
|---|---|
| Backend API | `http://localhost:8000` (`PORT=8000`) |
| Postgres (Docker) | `localhost:5433` (`POSTGRES_PORT=5433`; the native Postgres on this Mac holds 5432) |
| Redis (Docker) | `localhost:6379` |
| `DATABASE_URL` | `postgresql://flowleap:flowleap@localhost:5433/flowleap` |
| `REDIS_URL` | `redis://localhost:6379` |
| `SKIP_AUTH` | `true`: every request is the dev user `eval-user` / `eval@localhost`, no sign-in needed. `false`: real Clerk sign-in through the local website |
| Website | `http://localhost:3000` (`pnpm dev`; TanStack Start on nitro's default port) |
| Website → backend | `PUBLIC_BACKEND_URL=http://localhost:8000` (no `/v1`) |
| App → backend | `PATENT_API_URL=http://localhost:8000/v1` (keep the `/v1`) |
| App → website | derived: `localhost` in `PATENT_API_URL` → `http://localhost:3000`. Override: `PATENT_FRONTEND_URL` |

The backend `.env` on this Mac points `DATABASE_URL` at the hosted Supabase database. Do not run `db:migrate` or `db:seed` with it. Export the local URL on the command line: `.env` never overrides a variable that is already set.

## Backend (`~/flowleap/flowleap-backend`, branch `main`)

```bash
cd ~/flowleap/flowleap-backend
git pull
npm ci
POSTGRES_PORT=5433 docker compose -f docker-compose.dev.yml up -d postgres redis
DATABASE_URL=postgresql://flowleap:flowleap@localhost:5433/flowleap npm run db:seed
```

`npm run db:seed` comes with backend PR #607 (`scripts/dev-seed.ts`). Until it merges, check out `chore/local-dev-seed` or run `npx tsx scripts/dev-seed.ts` from that branch. It creates the `service_role` role first (the migration chain grants policies to it, so it must exist before `db:migrate`), applies the chain, and upserts the dev user with an active local subscription. It refuses a non-local `DATABASE_URL`. Run it as often as you like.

Start the API:

```bash
DATABASE_URL=postgresql://flowleap:flowleap@localhost:5433/flowleap REDIS_URL=redis://localhost:6379 PORT=8000 SKIP_AUTH=true npm run dev
```

### Proof

```text
GET /health      → {"status":"ok"}
GET /v1/health   → status ok, toolCount 52, db {applied 29, expected 29}, redis ok
POST /v1/tools/server_info      → providers epo_ops/uspto_odp/ocr configured: true
POST /v1/tools/search_patents   {"provider":"epo_ops","query":"ti=\"solid state battery\" and pd within \"2023 2024\""}
                                → total 2042, 25 docs, first CN119230723.A (5.3 s, upstream=ops)
npm run test:run                → 2187 passed, 7 skipped, 0 failed (with #607; before it 1 failed, see below)
```

The one failure before #607: the `.env` on this Mac has `SKIP_AUTH=true`, and `tests/setup.ts` reset it too late (after the lazy server import that loads dotenv). The `/mcp` 401-challenge test answered 200. #607 sets `SKIP_AUTH=false` at module scope.

Compose already uses plain `postgres:16`; migrations 0002/0003 guard the pgvector statements and 0028 drops the extension. Nothing to fix there.

## Website (`~/flowleap/flowleap-website-v2`, branch `master`)

The app's sign-in goes app → backend `/oauth/authorize` → website `/en/auth/flowleap` → Clerk sign-in → website `/api/auth/flowleap` mints the token → `flowleap://…/callback`. So the website must run locally too.

```bash
cd ~/flowleap/flowleap-website-v2
git pull
pnpm install --frozen-lockfile
PUBLIC_BACKEND_URL=http://localhost:8000 pnpm dev
```

Env: `.env` holds the Clerk **development** keys (`VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, both `*_test_`). They are the same Clerk instance as the backend `.env` keys, so a token the website mints verifies on the local backend. `.env.local` sets `PUBLIC_BACKEND_URL` to production; the inline export above wins (Vite never overrides a set variable). Export it every time, or edit `.env.local`.

Backend side: `FRONTEND_URL=http://localhost:3000` in the backend `.env` is already right (it is the default). The `flowleap://` redirect URIs are a fixed allowlist in `src/routes/oauth.ts`; nothing to configure.

### Proof (2026-10-22)

```text
GET localhost:8000/oauth/authorize?client_id=patent-ai-agent&redirect_uri=flowleap://flowleap.patent-ai-agent/callback&state=x
  → 302 http://localhost:3000/en/auth/flowleap?redirect_uri=…&state=x
GET localhost:3000/en/auth/flowleap?…   (signed out)
  → 307 http://localhost:3000/en/sign-in?…&auth_flow=flowleap
GET localhost:3000/en/sign-in?…         → 200 (Clerk sign-in page)
```

The website calls the backend only after sign-in (`/billing/subscription`), so that call shows in the backend log during the sign-in below.

## App (`~/flowleap/flowleap-agent-v2`, branch `main`)

```bash
cd ~/flowleap/flowleap-agent-v2
git pull
# npm ci only when node_modules/.package-lock.json is older than package-lock.json
# empty extensions/*/node_modules → VSCODE_FORCE_INSTALL=1 npm_command=ci node build/npm/postinstall.ts
npm run typecheck-client        # tsgo; never npm run compile
```

Build outputs (`out/`, `extensions/copilot/dist/`, `extensions/flowleap/out/`) must exist. The launch harness refuses to rebuild.

Launch against the local backend with the verify harness:

```bash
export PATENT_API_URL=http://localhost:8000/v1
C=.claude/skills/verify-flowleap-ide/scripts/control-flowleap-ide
$C up --unattended --seed-profile "$HOME/Library/Application Support/code-oss-dev"
$C doctor
```

Three things to know:

1. **The real dev profile is `~/Library/Application Support/code-oss-dev`**, not `~/.vscode-oss-dev` (that folder only holds the dev extensions dir). Seed from it and the throwaway copy carries the FlowLeap session, the Patent-Data Keys and the BYOK model keys. A fresh profile cannot sign in (issue #838: the `flowleap://` callback never reaches a throwaway profile).
2. **The restored folder opens in Restricted Mode** in the copied profile, and in Restricted Mode no FlowLeap extension loads (no FlowLeap Settings tab, no Patent Agent). Click the "Restricted Mode" status-bar item, then **Trust**. Everything loads within a second. `doctor` reports `window-title-marker` failed because the title is the folder name; that is expected with a seeded profile.
3. **Only one instance per profile.** If the dev app is already open on the default profile, `./scripts/code.sh` hands off to it and your `PATENT_API_URL` is ignored. The harness above uses its own profile copy, so it always starts a new instance.

### Proof

FlowLeap Settings shows the account the LOCAL backend answered (`GET /api/profile`, `GET /billing/subscription` → 200): **Eval User, eval@localhost, Active**.

![FlowLeap Settings account from the local backend](./local-dev-settings-proof.png)

One Patent Agent turn ("Use the get_bibliography tool once for EP2110298B1 …") hit the local backend. Backend log:

```text
[client-version] {"client":"vscode/0.55.0","method":"POST","route":"/v1/tools/get_bibliography"}
[req] POST /v1/tools/get_bibliography status=200 ms=1191 upstream=ops outcome=ok
```

Extension log: `[Patent AI] Backend URL: http://localhost:8000/v1` and `FlowLeap authentication active`.

![Patent Agent chat answer through the local backend](./local-dev-chat-proof.png)

`npm run typecheck-client`: green.

## Full sign-in from the app (default profile)

Only the default profile can receive the `flowleap://` callback (issue #838), and only one instance runs per profile. So:

1. Quit the dev app if it is open (it hands off otherwise, and `PATENT_API_URL` is dropped).
2. Run the backend with `SKIP_AUTH=false` (the command above with `false`), and the website.
3. Launch on the default profile:

   ```bash
   cd ~/flowleap/flowleap-agent-v2
   TMPDIR=/tmp PATENT_API_URL=http://localhost:8000/v1 ./scripts/code.sh
   ```

4. FlowLeap Settings → Sign out (the stored token was minted against production) → Sign In. The browser opens `localhost:3000`. Sign in on the Clerk **development** instance: your production account does not exist there, so sign up once.
5. The browser redirects to `flowleap://flowleap.patent-ai-agent/callback` and the app shows your account. Backend log: `GET /api/profile … status=200` and `GET /billing/subscription … status=200` (the local backend creates your user row and a 7-day app trial on first sign-in).

Step 4 is a human step: an agent must not enter the password. Status 2026-10-22: steps 1–3 and the redirect chain verified; step 4–5 pending the founder.

## Stop

```bash
$C down                                                   # app; evidence stays under .claude/skills/verify-flowleap-ide/artifacts/
docker compose -f docker-compose.dev.yml stop postgres redis   # backend; data stays in the postgres_data volume
# website: Ctrl-C in its terminal
```
