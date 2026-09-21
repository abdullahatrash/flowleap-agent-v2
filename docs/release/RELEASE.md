# FlowLeap Patent AI — release runbook

## Overview

```
git tag vX.Y.Z && git push --tags
        |
        v
.github/workflows/flowleap-release.yml (GitHub Actions)
        |
        +-- builds macOS DMGs, signs + notarizes + staples them
        +-- builds Windows artifacts (zip + two installers), UNSIGNED
        +-- builds Linux x64 + arm64 (.deb, .rpm, .tar.gz), UNSIGNED
        +-- computes SHASUMS256.txt
        +-- attaches everything to a DRAFT GitHub release
        |
        v
pwsh build/flowleap/sign-windows-release.ps1 -Tag vX.Y.Z   (run locally, Windows machine)
        |
        +-- downloads the .exe assets + SHASUMS256.txt
        +-- signs each .exe with the Certum SimplySign cloud cert
        +-- verifies each signature
        +-- patches SHASUMS256.txt with the new hashes
        +-- re-uploads signed .exe files + SHASUMS256.txt to the same draft
        |
        v
smoke test
        |
        v
build/flowleap/publish-public-release.sh vX.Y.Z [--clean-old]
        |
        +-- copies the finished assets to the PUBLIC repo
        |   (abdullahatrash/flowleap-releases) as a published release
        +-- the website (download page, changelog, /api/latest-version)
        |   reads ONLY that public repo
        +-- --clean-old then deletes every other public release + tag
```

Linux is never signed: apt and dnf verify packages through repository
signatures, not per-file ones, and FlowLeap is distributed as direct downloads
rather than through a repository. The .deb and .rpm therefore ship as CI built
them, and `SHASUMS256.txt` is what a user checks them against.

CI never touches Windows code-signing: the Certum SimplySign certificate lives in
a cloud HSM behind an interactive SimplySign Desktop session, so it can only be
used from a logged-in Windows machine, not from a GitHub-hosted runner. macOS
signing/notarization *is* fully automated in CI because Apple's Developer ID
certificate can be imported into a CI keychain non-interactively.

## One-time setup

### macOS signing secrets (GitHub repo secrets)

Run these from a machine with `gh` authenticated against this repo. Each
command prompts interactively so the secret value never touches shell history
or `.bash_history`.

| Secret | Where to get it |
| --- | --- |
| `CSC_LINK` | Base64 of your exported `Developer ID Application` `.p12` file |
| `CSC_KEY_PASSWORD` | The password you set when exporting the `.p12` from Keychain Access |
| `APPLE_ID` | The Apple ID (email) enrolled in the Apple Developer Program used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password generated at https://appleid.apple.com/account/manage |
| `APPLE_TEAM_ID` | Your 10-character Apple Developer Team ID, found at https://developer.apple.com/account under Membership |

The workflow generates its own ephemeral keychain password per run and
auto-discovers the `Developer ID Application: ...` identity from the imported
certificate, so there's nothing to set for either of those.

Tip: these are the same secret names/values used across the user's other app
repos — if they're already configured elsewhere, just copy the values across
rather than regenerating anything. `gh secret set` also accepts `--repo`, so
you can set a secret for this repo from anywhere: `gh secret set NAME --repo abdullahatrash/flowleap-agent-v2`.

```bash
# Certificate (base64-encoded .p12) — piped, never printed or stored in history
base64 -i /path/to/DeveloperIDApplication.p12 | gh secret set CSC_LINK

# Everything else: run each command, paste the value at the prompt, then Ctrl-D
gh secret set CSC_KEY_PASSWORD
gh secret set APPLE_ID
gh secret set APPLE_APP_SPECIFIC_PASSWORD
gh secret set APPLE_TEAM_ID
```

Verify they're all present:

```bash
gh secret list
```

### Windows signing prerequisites (local machine, one-time)

1. Install **SimplySign Desktop** (Certum's cloud-signing client) and log in
   with your Certum account. Leave it running whenever you sign a release —
   the certificate is not a local file, signtool talks to it through a CSP.
2. Install the **Windows SDK** (any recent version) so `signtool.exe` is
   available, typically under:
   `C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64\signtool.exe`
   `build/flowleap/sign-windows-release.ps1` will search this path automatically
   if `signtool` isn't already on `PATH`.
3. Install `pwsh` (PowerShell 7+) and the `gh` CLI, and run `gh auth login`
   once.

## Cutting a release

1. Close the changelog section. `CHANGELOG.md` keeps a `## [Unreleased]`
   heading that every user-facing PR adds to as it lands. Rename it to
   `## [X.Y.Z] - YYYY-MM-DD` and open a fresh empty `## [Unreleased]` above it.

   The release workflow copies that section verbatim into the GitHub release
   notes, so check it reads for someone downloading the app. Verify the
   extraction before tagging — an empty result silently falls back to generic
   notes:

   ```bash
   awk "/^## \[X.Y.Z\]/{flag=1;next}/^## \[/{flag=0}flag" CHANGELOG.md
   ```

2. Commit and tag. There is no version to bump: `build/flowleap/stamp-flowleap-version.mjs`
   reads the tag in CI and stamps `extensions/flowleap/package.json` at build
   time. The root `package.json` version is Code OSS's and is not the product
   version.

   ```bash
   git commit -m "release: CHANGELOG for vX.Y.Z" -- CHANGELOG.md
   git tag vX.Y.Z
   git push origin main --tags
   ```

   Tag only a commit whose CI is already green — the release workflow does not
   re-run the PR gate.

3. Watch the run in the **Actions** tab for `flowleap-release.yml`. Confirm:
   - macOS build+sign+notarize+staple jobs succeed.
   - Windows build job succeeds and uploads the unsigned zip + two `.exe`
     installers + `SHASUMS256.txt`.
   - A **draft** GitHub release was created for the tag.

4. On a Windows machine with SimplySign Desktop running and logged in:

   ```powershell
   pwsh build/flowleap/sign-windows-release.ps1 -Tag vX.Y.Z
   ```

   Omit `-Tag` to auto-sign the most recently created draft release.

5. Verification checklist before publishing:
   - [ ] macOS: `spctl -a -vvv -t install /path/to/FlowLeap.app` reports
         `accepted` and `source=Notarized Developer ID`.
   - [ ] macOS: `xcrun stapler validate /path/to/FlowLeap.app` succeeds.
   - [ ] Windows: `signtool verify /pa FlowLeap-Setup-vX.Y.Z-x64.exe` succeeds
         (the sign script already does this, but re-check manually if in doubt).
   - [ ] Windows: run the signed installer on a clean VM/user profile — no
         "Unknown publisher" SmartScreen warning, app launches.
   - [ ] Linux: `dpkg -I FlowLeap-vX.Y.Z-linux-x64.deb` reports
         `Package: flowleap`, the right `Architecture`, and a FlowLeap
         `Maintainer`/`Homepage` (never Microsoft's). The release job asserts
         all of this, so a green build already covers it.
   - [ ] Linux: install the .deb on a clean Ubuntu 22.04 and launch the GUI —
         CI only proves `flowleap --version` runs headless.
   - [ ] `SHASUMS256.txt` on the release matches the hashes of the actual
         uploaded files (`sha256sum -c` locally after downloading).

6. Publish to the PUBLIC distribution repo. End users and the website never see
   this repo's draft release — the download page, changelog page and
   `/api/latest-version` on `flowleap-website-v2` all read the GitHub releases
   of the public repo `abdullahatrash/flowleap-releases`. Copy the finished
   artifacts there:

   ```bash
   build/flowleap/publish-public-release.sh vX.Y.Z            # publish only
   build/flowleap/publish-public-release.sh vX.Y.Z --clean-old # ...and delete every other public release + tag
   ```

   The script downloads the draft's assets, checks the artifact set is complete
   (both DMGs + both signed installers), regenerates `SHASUMS256.txt` with flat
   paths and post-signing hashes, creates a **published** release on the public
   repo with the draft's notes, and verifies `releases/latest` now reports the
   new tag. `--clean-old` removes the older public releases only AFTER the new
   one is live, so the website never sees an empty repo.

   The draft on this (source) repo can stay a draft — it serves as the internal
   build record; publishing it is optional and has no user-facing effect.

## Linux specifics

Six artifacts per release: `.deb`, `.rpm` and `.tar.gz` for `x64` and `arm64`.

| Property | Value |
| --- | --- |
| Runners | `ubuntu-22.04` (x64), `ubuntu-22.04-arm` (arm64) |
| glibc baseline | 2.35 |
| Signing | none (see above) |
| Native updater | not armed — the Notify-Only Checker is the only update surface |

**The glibc baseline is set by the runner, not by a choice.** Building natively
on Ubuntu 22.04 links against its glibc 2.35, so the packages install on Ubuntu
22.04+, Debian 12+, Fedora 36+ and equivalents, and **not** on Ubuntu 20.04 or
RHEL 8. Upstream VS Code reaches glibc 2.28 by cross-compiling inside a
downloaded sysroot; we build natively per architecture instead, which is much
simpler and covers the distributions FlowLeap targets. Lowering the baseline
later means adopting upstream's sysroot cross-build, not changing a flag.

**The arm64 runner is free only because this repository is public.**
`ubuntu-22.04-arm` is a GitHub-hosted arm64 runner available at no cost to
public repositories and **unavailable in private ones** — a private repo fails
to schedule the job at all. If `abdullahatrash/flowleap-agent-v2` ever goes
private, the arm64 leg has to move to a cross-build (or a self-hosted arm64
runner) before the next release.

**Linux is deliberately not a Stamped Build.** ADR 0008 scopes native Silent
Update to macOS. The Linux job runs no `stamp-update-config.mjs` step, so the
built `product.json` carries no `updateUrl`, the native update service
self-disables with `MissingConfiguration`, and the Notify-Only Checker keeps
informing the user about new releases. The website Update Feed *does* already
map `linux-x64` and `linux-arm64` (to the `.tar.gz`, then the `.deb`), so
arming Linux later is a stamping change on this side only.

**Package versions come from Code OSS, not from the release tag.** The `.deb`
and `.rpm` internal `Version` is the root `package.json` version plus a build
timestamp (`1.105.0-1758…`), while the file *name* carries the FlowLeap version.
Upgrades still order correctly because the timestamp always increases, but
`dpkg -l flowleap` does not show the FlowLeap version. Read it from the app's
About dialog instead.

### Testing a pipeline change without minting a release

`workflow_dispatch` takes two extra inputs for exactly this:

```bash
gh workflow run flowleap-release.yml --ref <branch> \
  -f version=0.0.0-linux-test -f platforms=linux -f dry_run=true
```

`platforms` narrows the build to one OS (`all`, `macos`, `windows`, `linux`) and
`dry_run=true` skips the `create-release` job, so nothing is tagged or drafted —
the artifacts land on the workflow run only. Both inputs are empty on a tag
push, so the real release path is unaffected.

### Installing

```bash
sudo apt install ./FlowLeap-vX.Y.Z-linux-x64.deb     # Debian / Ubuntu
sudo dnf install ./FlowLeap-vX.Y.Z-linux-x64.rpm     # Fedora / RHEL
tar -xzf FlowLeap-vX.Y.Z-linux-x64.tar.gz && ./FlowLeap-linux-x64/flowleap
```

## Troubleshooting

- **Notarization rejected** — pull the full log:
  ```bash
  xcrun notarytool log <submission-id> --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD"
  ```
  Check for hardened-runtime entitlement issues or an unsigned nested binary
  in the app bundle.

- **SimplySign not connected** — `signtool sign` fails immediately with a
  CSP/token error. Open SimplySign Desktop, confirm the session shows
  "connected"/unlocked, and that the certificate is listed before retrying.
  The sign script is idempotent, so re-running it after fixing the connection
  is safe.

- **`signtool` not found** — install the Windows SDK, or add the directory
  containing `signtool.exe` to `PATH` manually. The script searches
  `Windows Kits\10\bin\*\x64\signtool.exe` automatically but will exit with a
  clear error if nothing is found.

- **`gh` not authenticated / rate-limited** — run `gh auth status`; re-login
  with `gh auth login` if needed. If asset download/upload is throttled, wait
  and retry — `gh release upload --clobber` and re-running the sign script are
  both safe to repeat.

- **`npm ci` hitting ripgrep/GitHub rate limits in CI** — usually a transient
  GitHub API/CDN throttle on the `@vscode/ripgrep` postinstall download.
  Re-run the failed workflow job; if it persists, check
  https://www.githubstatus.com/ before assuming it's repo-specific.

- **Linux: "The dependencies list has changed"** — `prepare-deb` or
  `prepare-rpm` failed the build on purpose. `build/linux/dependencies-generator.ts`
  recomputes the package `Depends`/`Requires` from the built binaries and
  compares them, exactly, against the reference lists in
  `build/linux/debian/dep-lists.ts` and `build/linux/rpm/dep-lists.ts`. Any
  change to a native module, to Electron, or to the runner image can shift them.
  The error prints both lists — verify the new dependencies are ones we are
  willing to require, then paste them into the matching arch entry of the
  reference list. Do not silence the guard: it is the only thing that notices a
  package quietly growing a new system requirement.

- **Linux: the arm64 job never starts** — `ubuntu-22.04-arm` does not exist for
  private repositories. Check the repo is still public; see "Linux specifics".

- **Re-running the sign script on an already-signed release** — safe.
  `signtool sign` re-signing an already-signed file is a normal operation,
  `signtool verify /pa` will simply re-confirm the signature, and
  `gh release upload --clobber` overwrites the previous assets.
