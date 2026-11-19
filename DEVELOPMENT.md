# Development

Thanks for improving CommitWriter.

## Setup

```bash
npm install
npm run verify      # typecheck + lint + tests + build
npm run package     # build a VSIX
```

Repository: <https://github.com/malikrajat/CommitWriter>

```bash
git remote add origin https://github.com/malikrajat/CommitWriter.git
git branch -M main
```

Press `F5` in VS Code to launch an Extension Development Host.

## Project layout

```
src/
  core/          pure TypeScript: domain, ports, context, security, message, summary
  git/           VS Code Git integration, diff collection, SCM writer
  providers/     dialects, adapters, HTTP choke point, retries
  config/        settings, profiles, secrets wiring, settings controller
  commands/      orchestration and command registration
  ui/            sidebar view, dialogs, status bar, progress
  secrets/       SecretStorage wrapper
  logging/       redacting logger
test/
  unit/          pure and adapter tests with mocks
  integration/   real Git repositories
  architecture/  invariants and layering
  audit/         scale and failure scenarios
```

`src/core` must never import `vscode`, Node built-ins, or perform network or file I/O.

## Invariants

These are non-negotiable and enforced by tests:

1. Never commit, stage, amend or restore Git state.
2. Never store API keys outside SecretStorage.
3. Only the commit-message writer may modify the SCM input box.
4. All network traffic goes through the single HTTP layer.
5. Diff content is untrusted data, never instructions.
6. No shell or subprocess execution.
7. No telemetry.
8. No TLS certificate-validation bypass.
9. No silent truncation: every omission is reported.

## Adding a provider

1. Add the id to `ProviderId` and `PROVIDER_IDS` in `src/core/domain/provider-profile.ts`.
2. Add a preset in `src/providers/presets.ts` (dialect, base URL, auth, model hint).
3. Reuse an existing dialect if the wire format matches; otherwise add one under `src/providers/dialect/` and register it in the registry.
4. Extend the provider enum in `package.json`.
5. Add a mocked adapter test covering request shape, parsing, errors and timeouts.
6. Update the provider table in the README.

## Testing

- Unit tests use Vitest and must not touch the network.
- Contract tests use a mock HTTP client and recorded payloads.
- Integration tests create real temporary Git repositories.
- Architecture tests protect layering and the invariants above.

Run `npm run verify` before opening a pull request.

## Coding rules

- Keep the core pure and deterministic.
- Never log prompts, diffs, headers or keys.
- Report omissions and truncation to the user.
- Prefer native VS Code UI over custom webviews.
- Keep messages and documentation in ASCII to avoid encoding issues.

## Commit messages

Use Conventional Commits. The extension can generate them, which is a good way to test it.


