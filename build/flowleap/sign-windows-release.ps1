<#
.SYNOPSIS
    Signs the unsigned Windows installers on a FlowLeap draft GitHub release with a
    Certum SimplySign cloud certificate, then re-uploads the signed files and an
    updated SHASUMS256.txt.

.DESCRIPTION
    The flowleap-release.yml workflow builds macOS DMGs (already signed and
    notarized) and Windows artifacts (left UNSIGNED, since code signing needs a
    physical/cloud HSM token that CI cannot hold) and attaches everything to a
    DRAFT GitHub release. This script is the one local command that finishes the
    job on Windows:

      1. Downloads the .exe assets and SHASUMS256.txt from the draft release.
      2. Signs each .exe with the Certum SimplySign cloud certificate via signtool.
      3. Verifies each signature.
      4. Recomputes the sha256 of the signed files and patches SHASUMS256.txt.
      5. Re-uploads the signed .exe files and the updated SHASUMS256.txt.

    Run this on a Windows machine with SimplySign Desktop installed, running, and
    logged in (the cloud certificate is presented to signtool through the
    SimplySign CSP/minidriver, there is no local .pfx file).

.PARAMETER Tag
    The release tag to sign, e.g. v1.2.3. If omitted, the script auto-detects the
    most recently created draft release via `gh release list`.

.EXAMPLE
    pwsh build/flowleap/sign-windows-release.ps1 -Tag v1.2.3

.EXAMPLE
    pwsh build/flowleap/sign-windows-release.ps1
    # signs whatever the newest draft release is
#>

[CmdletBinding()]
param(
	[Parameter(Mandatory = $false)]
	[string]$Tag
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Asset names produced by .github/workflows/flowleap-release.yml as of this
# writing. If the workflow's naming changes, update these patterns.
$script:ExeAssetPattern = '*.exe'
$script:ShasumsAssetName = 'SHASUMS256.txt'
$script:TimestampUrl = 'http://time.certum.pl'

function Write-Section {
	param([string]$Message)
	Write-Host ''
	Write-Host "=== $Message ===" -ForegroundColor Cyan
}

function Write-Info {
	param([string]$Message)
	Write-Host "[info] $Message"
}

function Write-WarningMessage {
	param([string]$Message)
	Write-Host "[warn] $Message" -ForegroundColor Yellow
}

function Write-Success {
	param([string]$Message)
	Write-Host "[ok]   $Message" -ForegroundColor Green
}

function Exit-WithError {
	param([string]$Message)
	Write-Host ''
	Write-Host "[FAIL] $Message" -ForegroundColor Red
	exit 1
}

function Find-SignTool {
	$existing = Get-Command 'signtool.exe' -ErrorAction SilentlyContinue
	if ($existing) {
		return $existing.Source
	}

	Write-WarningMessage "signtool.exe not found on PATH. Searching common Windows Kits install locations..."

	$searchRoots = @(
		"${env:ProgramFiles(x86)}\Windows Kits\10\bin",
		"$env:ProgramFiles\Windows Kits\10\bin"
	) | Where-Object { $_ -and (Test-Path $_) }

	$candidates = @()
	foreach ($root in $searchRoots) {
		$candidates += Get-ChildItem -Path $root -Filter 'signtool.exe' -Recurse -ErrorAction SilentlyContinue |
			Where-Object { $_.FullName -match '\\x64\\' }
	}

	if ($candidates.Count -eq 0) {
		Exit-WithError (
			"Could not find signtool.exe. Install the Windows SDK (Windows 10/11 SDK) " +
			"which ships signtool under a path like:`n" +
			"  C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64\signtool.exe`n" +
			"then either add that directory to PATH or re-run this script."
		)
	}

	# Prefer the highest SDK version (paths sort lexically well enough here).
	$best = $candidates | Sort-Object FullName -Descending | Select-Object -First 1
	Write-Info "Found signtool.exe at: $($best.FullName)"
	return $best.FullName
}

function Assert-GhAvailable {
	$gh = Get-Command 'gh' -ErrorAction SilentlyContinue
	if (-not $gh) {
		Exit-WithError "GitHub CLI ('gh') was not found on PATH. Install it from https://cli.github.com/ and run 'gh auth login' first."
	}

	$authCheck = & gh auth status 2>&1
	if ($LASTEXITCODE -ne 0) {
		Write-Host $authCheck
		Exit-WithError "gh is not authenticated. Run 'gh auth login' and try again."
	}
	Write-Info "gh is installed and authenticated."
}

function Get-LatestDraftTag {
	Write-Info "No -Tag supplied, looking up the most recent draft release..."

	$json = & gh release list --limit 30 --json tagName,isDraft,createdAt 2>&1
	if ($LASTEXITCODE -ne 0) {
		Write-Host $json
		Exit-WithError "Failed to list releases via 'gh release list'. Check that this directory is a clone of the FlowLeap repo with a configured git remote."
	}

	$releases = $json | ConvertFrom-Json
	$drafts = $releases | Where-Object { $_.isDraft } | Sort-Object { [datetime]$_.createdAt } -Descending

	if (-not $drafts -or $drafts.Count -eq 0) {
		Exit-WithError "No draft releases found. Pass -Tag explicitly, or push a release tag to trigger flowleap-release.yml first."
	}

	$latest = $drafts | Select-Object -First 1
	Write-Info "Auto-detected draft release: $($latest.tagName)"
	return $latest.tagName
}

function Confirm-SimplySignRunning {
	Write-Section "SimplySign Desktop check"
	Write-WarningMessage (
		"This script cannot verify SimplySign Desktop's state automatically. " +
		"Before continuing, make sure:"
	)
	Write-Host "  1. SimplySign Desktop is installed and running (check the system tray)."
	Write-Host "  2. You are logged in and the cloud token session is active/unlocked."
	Write-Host "  3. The Certum certificate shows as available in the SimplySign Desktop app."
	Write-Host ''
	Write-Host "If signtool fails below with a signing/CSP error, this is the most likely cause."
}

function Invoke-DownloadAssets {
	param(
		[string]$Tag,
		[string]$WorkDir
	)

	Write-Section "Downloading release assets for $Tag"
	New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null

	& gh release download $Tag --dir $WorkDir --pattern $script:ExeAssetPattern --pattern $script:ShasumsAssetName --clobber
	if ($LASTEXITCODE -ne 0) {
		Exit-WithError "Failed to download assets for release '$Tag'. Verify the tag exists and has .exe assets and SHASUMS256.txt attached."
	}

	$exeFiles = @(Get-ChildItem -Path $WorkDir -Filter '*.exe' -File)
	if ($exeFiles.Count -eq 0) {
		Exit-WithError "No .exe files were downloaded for release '$Tag'. Nothing to sign."
	}

	$shasumsPath = Join-Path $WorkDir $script:ShasumsAssetName
	if (-not (Test-Path $shasumsPath)) {
		Exit-WithError "Downloaded assets do not include $($script:ShasumsAssetName). Cannot update checksums."
	}

	Write-Success "Downloaded $($exeFiles.Count) .exe file(s) and $($script:ShasumsAssetName) into $WorkDir"
	return [pscustomobject]@{
		ExeFiles     = $exeFiles
		ShasumsPath  = $shasumsPath
	}
}

function Invoke-SignExe {
	param(
		[string]$SignToolPath,
		[string]$FilePath
	)

	Write-Info "Signing $(Split-Path -Leaf $FilePath)..."
	& $SignToolPath sign /tr $script:TimestampUrl /td sha256 /fd sha256 /a "$FilePath"
	if ($LASTEXITCODE -ne 0) {
		Exit-WithError (
			"signtool sign failed for '$FilePath' (exit code $LASTEXITCODE). " +
			"Common causes: SimplySign Desktop is not running/authenticated, no eligible " +
			"code-signing certificate is available, or the timestamp server is unreachable."
		)
	}

	Write-Info "Verifying signature on $(Split-Path -Leaf $FilePath)..."
	& $SignToolPath verify /pa "$FilePath"
	if ($LASTEXITCODE -ne 0) {
		Exit-WithError "signtool verify failed for '$FilePath' (exit code $LASTEXITCODE). The signature did not verify as valid."
	}

	Write-Success "Signed and verified: $(Split-Path -Leaf $FilePath)"
}

function Update-Shasums {
	param(
		[string]$ShasumsPath,
		[System.IO.FileInfo[]]$SignedFiles
	)

	Write-Section "Updating $($script:ShasumsAssetName)"

	$lines = [System.Collections.Generic.List[string]]::new()
	Get-Content -Path $ShasumsPath | ForEach-Object { $lines.Add($_) }

	foreach ($file in $SignedFiles) {
		$fileName = $file.Name
		$newHash = (Get-FileHash -Path $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()

		$matchIndex = -1
		for ($i = 0; $i -lt $lines.Count; $i++) {
			# Match on filename regardless of leading path/./ prefix or separator style,
			# so we don't depend on the exact "sha256sum" output format used by CI.
			if ($lines[$i] -match [regex]::Escape($fileName) + '\s*$') {
				$matchIndex = $i
				break
			}
		}

		if ($matchIndex -ge 0) {
			$oldLine = $lines[$matchIndex]
			# Replace only the leading hash token, keep everything else (spacing, path) intact.
			$newLine = $oldLine -replace '^\S+', $newHash
			$lines[$matchIndex] = $newLine
			Write-Info "Updated checksum for $fileName"
			Write-Info "  old: $oldLine"
			Write-Info "  new: $newLine"
		}
		else {
			$appendedLine = "$newHash  ./$fileName"
			$lines.Add($appendedLine)
			Write-WarningMessage "No existing entry for $fileName in $($script:ShasumsAssetName); appended: $appendedLine"
		}
	}

	Set-Content -Path $ShasumsPath -Value $lines -Encoding ascii
	Write-Success "$($script:ShasumsAssetName) updated at $ShasumsPath"
}

function Invoke-UploadAssets {
	param(
		[string]$Tag,
		[string[]]$Files
	)

	Write-Section "Uploading signed assets to $Tag"
	& gh release upload $Tag @Files --clobber
	if ($LASTEXITCODE -ne 0) {
		Exit-WithError "Failed to upload signed assets to release '$Tag' via 'gh release upload'."
	}
	Write-Success "Uploaded $($Files.Count) file(s) to release '$Tag'"
}

# --- main -------------------------------------------------------------------

Write-Section "FlowLeap Windows release signing"

Assert-GhAvailable
$signToolPath = Find-SignTool
Write-Info "Using signtool: $signToolPath"

if (-not $Tag) {
	$Tag = Get-LatestDraftTag
}

Confirm-SimplySignRunning

$workDir = Join-Path $env:TEMP "flowleap-sign-$Tag-$(Get-Date -Format 'yyyyMMddHHmmss')"
$assets = Invoke-DownloadAssets -Tag $Tag -WorkDir $workDir

Write-Section "Signing $($assets.ExeFiles.Count) installer(s)"
foreach ($exe in $assets.ExeFiles) {
	Invoke-SignExe -SignToolPath $signToolPath -FilePath $exe.FullName
}

Update-Shasums -ShasumsPath $assets.ShasumsPath -SignedFiles $assets.ExeFiles

$uploadFiles = @($assets.ExeFiles | ForEach-Object { $_.FullName })
$uploadFiles += $assets.ShasumsPath
Invoke-UploadAssets -Tag $Tag -Files $uploadFiles

Write-Section "Done"
Write-Success "Release '$Tag' now has signed Windows installers and an updated $($script:ShasumsAssetName)."
Write-Host ''
Write-Host "Working directory (kept for inspection): $workDir"
Write-Host ''
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Download and run at least one signed installer to smoke-test it."
Write-Host "  2. Confirm Windows does not show an 'Unknown publisher' warning."
Write-Host "  3. Publish the draft release: gh release edit $Tag --draft=false"
