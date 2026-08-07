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

# The suite runs the PINNED promptfoo from evals/package.json, never a global install —
# see README.md, "promptfoo version policy". scripts/promptfoo.ts enforces that.
if [ ! -d "${EVALS_DIR}/node_modules/promptfoo" ]; then
	echo "ERROR: the pinned promptfoo is not installed."
	echo "Install it: npm run eval:setup   (from extensions/copilot)"
	exit 1
fi

# Regenerate tool definitions
echo "Extracting tool definitions..."
npx tsx "${EVALS_DIR}/prompts/extract-tools.ts"

# Run evals
echo "Running evaluations..."
cd "$EVALS_DIR"
npx tsx "${SCRIPT_DIR}/promptfoo.ts" eval -c promptfooconfig.yaml "$@"

echo ""
echo "Done. View results with: npm run eval:view"
