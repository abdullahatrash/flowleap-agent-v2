# Native silent app updates via the website Update Feed

**Status:** accepted

Until now the app had no real updater. A custom **Notify-Only Checker**
(`extensions/flowleap/src/updateNotifier/updateNotifier.ts`) polled
`www.flowleap.co/api/latest-version` every 4 hours and showed a toast whose Download button
opened the marketing download page; the user reinstalled by hand. VS Code's native update
machinery (`src/vs/platform/update/**`, Squirrel.Mac on macOS, inno_updater on Windows) was
fully intact but **inert**, because `product.json` carries no `updateUrl`/`quality`/`commit` —
the service self-disables with `MissingConfiguration`.

We **adopt Silent Update on the native machinery** instead of growing the custom notifier into
an installer: the app downloads a new release in the background and installs it on the next
restart, surfacing only the passive "Restart to Update" affordance. Users keep the native
`update.mode` setting as the opt-out. Rollout is **macOS first**; Windows follows once its
signing-order constraint (below) is handled. The fork's own code needs almost no changes — the
decision is configuration plus release-pipeline work.

## The decisions

1. **The Update Feed is the existing website route** `www.flowleap.co/api/update/{platform}/{quality}/{commit}`
   (`flowleap-website-v2/src/routes/api.update.$.ts`), which already implements the VS Code
   update protocol against the public `abdullahatrash/flowleap-releases` repo. No new
   infrastructure. Rejected: a static manifest in the releases repo (needs fork-side protocol
   changes) and a dedicated update server (overkill, nothing to track yet).
   The feed URL is effectively **permanent** — every shipped client polls the URL stamped into
   it forever — which is why this ADR exists.
2. **Release identity, not version tricks.** The feed today ignores `{commit}` and always
   serves the latest asset — pointed at as-is, Squirrel.Mac would reinstall in a loop. The fix:
   the publish script (`build/flowleap/publish-public-release.sh`) attaches the source commit
   sha as release metadata on `flowleap-releases`, and the feed becomes a pure equality check —
   `{commit}` matches the latest release's sha → `204 No Update`, otherwise the manifest.
   Rejected: stamping `product.json` `commit` with the version string — `commit` feeds
   settings-sync, crash reporting, and cache paths, and lying in it is a latent foot-gun.
3. **Stamped Builds only.** `updateUrl` and `quality` (`stable`, the single channel) are
   injected by the release workflow at build time, following the existing
   `stamp-flowleap-version.mjs` pattern. The checked-in `product.json` stays clean, so dev and
   local builds never poll and can never "update" themselves onto the public release.
4. **Notify-Only Checker is demoted, not deleted.** It is suppressed on any build where the
   native updater is armed (macOS stamped builds), and retained everywhere else — Windows until
   its follow-up ships, plus dev-build and native-updater-disabled fallback. It informs; it
   never installs.
5. **Rollback = roll-forward, plus an emergency brake.** Normal fix for a bad release is
   publishing a higher version. Emergency: delete the bad release on `flowleap-releases`;
   `releases/latest` reverts, the equality check no longer matches clients on the bad version,
   and the feed serves them the previous release — a silent **downgrade**. This brake is a
   direct consequence of decision 2 and must stay documented in `docs/release/RELEASE.md`.

## Consequences

- **macOS pipeline gains a Squirrel archive.** Squirrel.Mac cannot install a `.dmg`; it needs
  a `.zip` of the signed, notarized, stapled `.app`. Today the workflow's macOS zip is a
  create-dmg **failure fallback** that ships un-notarized — a healthy release has no zip at
  all. The release workflow must produce a real per-arch `.zip` from the stapled `.app` on
  every release, the publish script must require it, and the feed's darwin platform map
  (`update-manifest.ts`) must switch from `.dmg` to that `.zip`. The `.dmg` remains the
  human download.
- **Windows has a hard ordering rule when it follows.** CI produces unsigned installers;
  signing is a manual local step (Certum cloud HSM via SimplySign) against the draft release.
  A silent updater auto-downloads and runs those exes, so **sign-before-publish becomes a
  safety invariant**, not a convention. The feed's win32 map also lacks the user-vs-system
  setup distinction (`win32-x64-user`) the native updater requests.
- Update checks move from the toast's 4-hour cycle to the native updater's ~1-hour default on
  macOS; Linux is out of scope (no Linux builds exist).
- Glossary terms for this area — **Silent Update**, **Update Feed**, **Notify-Only Checker**,
  **Stamped Build** — live in `CONTEXT.md` ("App updates"); the Plugin Marketplace remains the
  update channel for *plugins* only.
