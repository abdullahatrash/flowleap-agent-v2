# Port the patent agent into the built-in copilot extension (single repo, no sync)

**Status:** accepted

Recent VS Code ships GitHub Copilot Chat in-tree as `extensions/copilot/`, whose
`src/extension/` layout is structurally identical to the old standalone
`vscode-copilot-chat` repo (same `agents`, `byok`, `intents`, `tools`, `chat`, … —
the only difference is the patent fork's added `src/extension/patentai/` folder). We
therefore port the patent agent (the `patentai/` folder, ~70 tools, agent intent, and
system-prompt adaptation) **directly into the new fork's built-in `extensions/copilot/`**,
retire `vscode-copilot-chat` as a build input, and delete `sync-to-vscode.sh`. One repo,
no sync.

## Considered options

- **Single-repo port (chosen).** Patent code becomes an additive overlay on the in-tree
  copilot extension.
- **Keep two-repo + sync.** Continue developing in `vscode-copilot-chat` and sync into
  `extensions/patent-ai-agent/`, deleting the upstream `extensions/copilot/` on every merge.
  Rejected: this *is* the set of "hacky ways" we set out to remove (the sync script, the
  package.json minify-restore, per-merge deletion of `extensions/copilot/`, residual-file
  scrubbing).
- **Thin add-on extension over a pristine copilot.** Rejected: the patent fork modifies
  copilot internals (tool registry, agent provider, prompt assembly), which an external
  extension cannot reach.

## Consequences

- Upstream `microsoft/vscode` merges now conflict **inside** the copilot extension rather
  than being side-stepped by deletion. Mitigated because most patent code is a self-contained
  `patentai/` folder; conflicts concentrate at a few registration seams (tool registry, agent
  types, prompt include).
- The port crosses a version gap — the patent fork was built on copilot-chat `0.39.0`
  (vscode `1.121.0`); the new base is copilot-chat `0.55.0` (vscode `1.127.0`). Patent
  changes must be **re-applied** onto the newer base, not copy-pasted.
- `vscode-copilot-chat` and `extensions/patent-ai-agent/` cease to exist as shipping
  artifacts in the new fork.
