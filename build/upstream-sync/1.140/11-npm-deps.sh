#!/usr/bin/env bash
# PRD 0017 v2 step 11 (forced, outside src/): npm dependencies upstream src/vs 1.140 needs to compile and render.
# Installs upstream 480c6e142fa's exact lockfile versions, then writes upstream's package.json ranges.
# Refuses to install into a symlinked (shared) node_modules.
set -euo pipefail
W="${1:?worktree}"
if [ -L "$W/node_modules" ]; then echo "node_modules is a symlink; clone it first (cp -c -R <main>/node_modules $W/node_modules)" >&2; exit 1; fi
cd "$W"
npm install --ignore-scripts --no-audit --no-fund --save-exact \
	@vscode/os-proxy-resolver@0.4.0 foundry-local-sdk@1.2.3 @vscode/proxy-agent@0.45.0 tas-client@0.4.6 zod@4.4.3 @vscode/codicons@0.0.46-40 >/dev/null
npm install --ignore-scripts --no-audit --no-fund --save-exact --save-dev \
	@vscode/component-explorer@0.2.1-140 @vscode/component-explorer-cli@0.2.1-143 >/dev/null
# upstream's declared ranges
sed -i '' \
	-e 's#"@vscode/os-proxy-resolver": "0.4.0"#"@vscode/os-proxy-resolver": "^0.4.0"#' \
	-e 's#"@vscode/proxy-agent": "0.45.0"#"@vscode/proxy-agent": "^0.45.0"#' \
	-e 's#"zod": "4.4.3"#"zod": "^4.4.3"#' \
	-e 's#"@vscode/codicons": "0.0.46-40"#"@vscode/codicons": "^0.0.46-40"#' \
	-e 's#"@vscode/component-explorer": "0.2.1-140"#"@vscode/component-explorer": "^0.2.1-140"#' \
	-e 's#"@vscode/component-explorer-cli": "0.2.1-143"#"@vscode/component-explorer-cli": "^0.2.1-143"#' \
	package.json
# npm on macOS drops the optional ssh2/cpu-features stub that `npm ci` on Linux CI requires; keep main's stub
python3 - package-lock.json <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
stub = '    "node_modules/ssh2/node_modules/cpu-features": {\n      "optional": true\n    },\n'
anchor = '    "node_modules/stable": {\n'
if stub not in s:
	assert anchor in s
	s = s.replace(anchor, stub + anchor, 1)
	open(p, 'w').write(s)
PY
# the fork's layers checker loads the whole 1.140 program (peak ~5.2 GB); upstream moved to layersTypeCheck.ts (build/, not synced)
sed -i '' 's#"valid-layers-check": "node build/checker/layersChecker.ts#"valid-layers-check": "node --max-old-space-size=8192 build/checker/layersChecker.ts#' package.json
echo "11 done"
