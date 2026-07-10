#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVALS_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$EVALS_DIR")"

# The provider talks to an OpenAI-compatible endpoint directly (OpenRouter by
# default) with a BYO key — there is no backend to health-check anymore.
if [ -z "${EVAL_API_KEY:-}" ] && [ -z "${OPENROUTER_API_KEY:-}" ]; then
	echo "ERROR: No API key configured."
	echo "Set EVAL_API_KEY (for a custom EVAL_API_BASE_URL) or OPENROUTER_API_KEY (default: OpenRouter) before running evals."
	exit 1
fi

if ! command -v promptfoo > /dev/null 2>&1; then
	echo "ERROR: promptfoo not found on PATH."
	echo "Install it globally: npm i -g promptfoo"
	exit 1
fi

# Regenerate tool definitions
echo "Extracting tool definitions..."
npx tsx "${EVALS_DIR}/prompts/extract-tools.ts"

# Run evals
echo "Running evaluations..."
cd "$EVALS_DIR"
promptfoo eval -c promptfooconfig.yaml "$@"

echo ""
echo "Done. View results with: npm run eval:view"
