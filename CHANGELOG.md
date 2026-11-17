# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-16

First public release.

### Added

- Generate Conventional Commit messages from Git changes and write them to the Source Control input box.
- Staged-only analysis by default; unstaged and untracked analysis is configurable.
- Provider profiles for OpenAI, DeepSeek, Anthropic, Google Gemini, OpenRouter, Ollama, OpenCode and custom endpoints.
- Provider settings hub: add, edit, remove, switch, test connection, validate configuration, set API key.
- Native support for four API formats: OpenAI chat, Anthropic messages, Gemini `generateContent`, Ollama native chat, plus the OpenCode session API.
- Conventional Commits validation with configurable types, scopes and subject length.
- Quick, Smart and Detailed generation modes with token budgets and per-mode overrides.
- Large-repository pipeline: file classification, directory grouping, chunking, map-reduce summaries, retries, caching and explicit limitations.
- Change overview with primary/secondary areas, scope suggestions, and grounding checks against the actual changed files.
- Draft protection (Replace / Append / Cancel), Undo, Regenerate, Copy and local fallback when the model fails.
- Support for multiple Git repositories, worktrees, virtual file systems and repositories that are not yet initialized.
- Progress reporting with cancellation, and actionable error messages for authentication, rate limits, timeouts, network and provider failures.

### Security

- API keys stored exclusively in VS Code SecretStorage.
- Always-on redaction of credentials in outgoing request bodies and provider error responses.
- Sensitive-file blocking with a per-run override.
- HTTPS enforcement for remote custom endpoints; loopback HTTP allowed for local models.
- No automatic Git commits, staging or history changes.

[1.0.0]: https://github.com/malikrajat/CommitWriter/releases/tag/v1.0.0


