#!/usr/bin/env bash
#
# Publishes a FlowLeap release to the PUBLIC distribution repo.
#
# The flowleap-release.yml workflow attaches all artifacts to a DRAFT release on
# the private source repo (abdullahatrash/flowleap-agent-v2). After the Windows
# installers have been signed locally (sign-windows-release.ps1), this script
# copies the finished artifacts to the public repo the website reads from
# (abdullahatrash/flowleap-releases): the download page, the changelog page and
# /api/latest-version all consume that repo's GitHub releases.
#
#   1. Downloads every asset from the source draft release.
#   2. Sanity-checks the expected artifact set (DMGs + signed installers).
#   3. Regenerates SHASUMS256.txt from the actual files (the CI-generated one
#      uses subdirectory paths and pre-signing hashes for the .exe files).
#   4. Creates a PUBLISHED release on the public repo with the same tag and the
#      draft's release notes.
#   5. With --clean-old: afterwards deletes every OTHER release (and its tag)
#      from the public repo, so only the new release remains.
#
# Order matters: the new public release is created BEFORE old ones are removed,
# so the website never sees an empty repo.
#
# Usage:
#   build/flowleap/publish-public-release.sh v0.1.0 [--clean-old] [--yes]

set -euo pipefail

SRC_REPO="abdullahatrash/flowleap-agent-v2"
DST_REPO="abdullahatrash/flowleap-releases"

TAG="${1:?usage: publish-public-release.sh vX.Y.Z [--clean-old] [--yes]}"
shift
CLEAN_OLD=0
ASSUME_YES=0
for arg in "$@"; do
	case "$arg" in
		--clean-old) CLEAN_OLD=1 ;;
		--yes) ASSUME_YES=1 ;;
		*) echo "unknown flag: $arg" >&2; exit 2 ;;
	esac
done

if ! [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+ ]]; then
	echo "error: tag '$TAG' does not look like vX.Y.Z" >&2
	exit 2
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

echo "==> Downloading assets of $SRC_REPO@$TAG (draft) ..."
gh release download "$TAG" --repo "$SRC_REPO" --dir "$WORKDIR"

cd "$WORKDIR"
# The CI SHASUMS256.txt is superseded by the one regenerated below.
rm -f SHASUMS256.txt

echo "==> Downloaded assets:"
ls -la

# The set a complete release must carry. The plain win32 zip is optional.
missing=0
for pattern in "*darwin-arm64.dmg" "*darwin-x64.dmg" "FlowLeap-Setup-*.exe" "FlowLeap-UserSetup-*.exe"; do
	if ! compgen -G "$pattern" > /dev/null; then
		echo "error: expected asset matching '$pattern' not found" >&2
		missing=1
	fi
done
if [ "$missing" -ne 0 ]; then
	echo "Aborting: incomplete artifact set. Did the release build finish, and did sign-windows-release.ps1 run?" >&2
	exit 1
fi

# Reminder rather than a hard gate: unsigned installers are indistinguishable
# here without signtool, so the operator confirms below.
echo
echo "NOTE: verify the .exe files above are the SIGNED ones (sign-windows-release.ps1 must have re-uploaded them)."

echo "==> Regenerating SHASUMS256.txt ..."
shasum -a 256 -- * > SHASUMS256.txt
cat SHASUMS256.txt

echo "==> Fetching release notes from the source draft ..."
gh release view "$TAG" --repo "$SRC_REPO" --json body --jq .body > notes.md
if [ ! -s notes.md ]; then
	echo "error: source release has no notes body" >&2
	exit 1
fi

if [ "$ASSUME_YES" -ne 1 ]; then
	printf '\nPublish these assets as %s on %s? [y/N] ' "$TAG" "$DST_REPO"
	read -r reply
	case "$reply" in y|Y|yes) ;; *) echo "aborted"; exit 1 ;; esac
fi

echo "==> Creating published release $DST_REPO@$TAG ..."
assets=()
while IFS= read -r f; do assets+=("$f"); done < <(find . -maxdepth 1 -type f ! -name notes.md -exec basename {} \;)
gh release create "$TAG" --repo "$DST_REPO" \
	--title "FlowLeap $TAG" \
	--notes-file notes.md \
	--latest \
	"${assets[@]}"

echo "==> Verifying the public 'latest' release ..."
latest=$(gh api "repos/$DST_REPO/releases/latest" --jq .tag_name)
if [ "$latest" != "$TAG" ]; then
	echo "error: releases/latest reports '$latest', expected '$TAG'" >&2
	exit 1
fi
echo "OK: $DST_REPO latest is $TAG"

if [ "$CLEAN_OLD" -eq 1 ]; then
	echo "==> Removing all OTHER releases (and their tags) from $DST_REPO ..."
	gh release list --repo "$DST_REPO" --limit 100 --json tagName --jq '.[].tagName' | while IFS= read -r old; do
		if [ "$old" != "$TAG" ]; then
			echo "  deleting release + tag: $old"
			# --cleanup-tag exits non-zero for DRAFT releases (they have no git
			# tag), even though the release itself is deleted — don't abort the
			# sweep on that; the stray-tag pass below catches real leftovers.
			gh release delete "$old" --repo "$DST_REPO" --cleanup-tag --yes || echo "  (tag cleanup failed for $old — likely a draft; continuing)"
		fi
	done
	# Tags without releases (e.g. from deleted drafts) linger; sweep those too.
	gh api "repos/$DST_REPO/tags" --jq '.[].name' | while IFS= read -r old; do
		if [ "$old" != "$TAG" ]; then
			echo "  deleting stray tag: $old"
			gh api -X DELETE "repos/$DST_REPO/git/refs/tags/$old" || true
		fi
	done
	echo "==> Remaining releases:"
	gh release list --repo "$DST_REPO"
fi

echo
echo "Done. Release page: https://github.com/$DST_REPO/releases/tag/$TAG"
