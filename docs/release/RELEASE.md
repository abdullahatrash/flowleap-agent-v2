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
smoke test -> gh release edit vX.Y.Z --draft=false
```

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

1. Bump the version and tag it:

   ```bash
   npm version <patch|minor|major> --no-git-tag-version   # or hand-edit package.json
   git commit -am "Release vX.Y.Z"
   git tag vX.Y.Z
   git push origin main --tags
   ```

2. Watch the run in the **Actions** tab for `flowleap-release.yml`. Confirm:
   - macOS build+sign+notarize+staple jobs succeed.
   - Windows build job succeeds and uploads the unsigned zip + two `.exe`
     installers + `SHASUMS256.txt`.
   - A **draft** GitHub release was created for the tag.

3. On a Windows machine with SimplySign Desktop running and logged in:

   ```powershell
   pwsh build/flowleap/sign-windows-release.ps1 -Tag vX.Y.Z
   ```

   Omit `-Tag` to auto-sign the most recently created draft release.

4. Verification checklist before publishing:
   - [ ] macOS: `spctl -a -vvv -t install /path/to/FlowLeap.app` reports
         `accepted` and `source=Notarized Developer ID`.
   - [ ] macOS: `xcrun stapler validate /path/to/FlowLeap.app` succeeds.
   - [ ] Windows: `signtool verify /pa FlowLeap-Setup-vX.Y.Z-x64.exe` succeeds
         (the sign script already does this, but re-check manually if in doubt).
   - [ ] Windows: run the signed installer on a clean VM/user profile — no
         "Unknown publisher" SmartScreen warning, app launches.
   - [ ] `SHASUMS256.txt` on the release matches the hashes of the actual
         uploaded files (`sha256sum -c` locally after downloading).

5. Publish the draft:

   ```bash
   gh release edit vX.Y.Z --draft=false
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

- **Re-running the sign script on an already-signed release** — safe.
  `signtool sign` re-signing an already-signed file is a normal operation,
  `signtool verify /pa` will simply re-confirm the signature, and
  `gh release upload --clobber` overwrites the previous assets.
