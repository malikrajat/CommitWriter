# Contributing to CommitWriter

Thanks for your interest. This project follows the
[Contributor Covenant](CODE_OF_CONDUCT.md).

## Quick links

- [Development setup and architecture](DEVELOPMENT.md)
- [Architecture details](ARCHITECTURE.md)
- [Best practices](BEST_PRACTICES.md)
- [Security policy](SECURITY.md)
- [Support](SUPPORT.md)

## Before you start

- Search existing issues before opening a new one.
- For security problems, follow [SECURITY.md](SECURITY.md) instead of opening a
  public issue.
- Keep pull requests focused. One concern per PR.

## Workflow

1. Fork the repository and create a branch.
2. Run `npm install` and `npm run verify`.
3. Add or update tests for the behavior you change.
4. Update documentation when behavior, settings or commands change.
5. Open a pull request describing the problem, the approach and the tests run.

## Requirements for a pull request

- `npm run verify` passes: typecheck, lint, tests and build.
- The core (`src/core`) stays free of VS Code and Node imports.
- No new telemetry, no shell execution, no automatic Git operations.
- No secrets, prompts or diffs in logs.
- User-visible strings are ASCII and explained in the UI.

## Commit messages

Use Conventional Commits. CommitWriter itself can generate them, which is a
useful way to try the extension.
