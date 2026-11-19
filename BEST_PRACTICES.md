# Best practices

## For users

### Stage with intent

CommitWriter analyses what you select. Staging a focused change produces a
better message than a mixed work-in-progress. Use the staged default and only
enable unstaged or untracked files when you really want them described.

### Review before committing

The message is a draft. Edit it, adjust the scope, or regenerate. Nothing is
committed automatically, by design.

### Keep secrets out of diffs

`.env`, key material, `.ssh`, `.aws` and credential stores are blocked by
default. Do not disable that for convenience. If a secret reaches a diff by
accident, rotate it; redaction is a safety net, not a guarantee.

### Choose local mode for confidential code

Enable `commitwriter.privacy.localOnly` with Ollama, LM Studio, llama.cpp or
vLLM when code must not leave the machine. Confirm the local server is running.

### Control cost and latency

- Use Quick mode for small changes.
- Lower `maxDiffTokens` and `maxFiles` for large repositories.
- Exclude generated code, lockfiles and vendored folders.
- Use Detailed mode only when a richer body is worth the extra requests.

### Pick the right model

A fast, cheap model is usually enough for a subject line. Use a stronger model
for Detailed mode or unfamiliar codebases. Local coding models work well for
small diffs.

### Rotate keys

Keys live in the OS keychain. Rotate them through your provider, then update the
profile with **Set API key**.

## For teams

- Store profiles per machine; they are intentionally not synced.
- Do not commit provider profiles to a repository.
- Agree on Conventional Commit types and scopes, then set
  `conventional.types` and `conventional.allowedScopes`.
- Use `commitwriter.privacy.localOnly` on air-gapped or regulated machines.
- Review the [security model](SECURITY.md) before approving network access.

## For contributors

### Keep the core pure

`src/core` must not import VS Code, Node built-ins, or perform I/O. If logic
needs an effect, add a port and implement it in an adapter.

### Preserve the invariants

Never add a Git mutation, a second HTTP client, a second input-box writer, a
shell call, telemetry, or a TLS bypass. Tests will fail, and the guarantees are
the product.

### Report, do not hide

If a file is omitted, truncated, or fails to summarize, surface it in coverage
and limitations. Silent loss is a defect.

### Test behavior, not implementation

Prefer tests that describe user-visible behavior: request shape, error mapping,
budget limits, omission reporting, message validation.

### Keep strings ASCII

The UI and documentation use ASCII to avoid encoding problems across shells and
packaging tools.

### Document changes

Update README, HELP, CHANGELOG and settings description when behavior changes.
If a limitation is known, write it down.

## Anti-patterns

- Auto-committing or auto-staging.
- Storing keys in settings or workspace files.
- Logging prompts or diffs "for debugging".
- Trusting model output as a command or a file path.
- Adding a provider by copying a whole client instead of a dialect.
- Truncating without telling the user.
- Adding a webview when a QuickPick would do.
