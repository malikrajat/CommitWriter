# Architecture

CommitWriter is a VS Code extension that turns a Git change set into a commit
message with an AI provider. This document describes the structure, the data
flow, and the rules that keep it safe.

## Design goals

1. Keep commit logic independent of VS Code so it can be tested in plain Node.
2. Treat all repository content as untrusted input.
3. Never mutate Git state.
4. Make every network request pass through one auditable layer.
5. Degrade explicitly: report omissions instead of hiding them.

## Layers

```
+-------------------------------------------------------------+
| extension.ts / container.ts (composition root, DI)          |
+------------------------------+------------------------------+
| commands/  ui/               | git/  providers/  config/    |
| orchestration, commands      | adapters to VS Code and HTTP |
+------------------------------+------------------------------+
| core/                                                       |
| domain  ports  context  security  message  summary  product |
| pure TypeScript, no vscode, no node, no network             |
+-------------------------------------------------------------+
```

### `src/core`

- `domain`: change sets, files, hunks, messages, profiles, errors, selection.
- `ports`: interfaces for Git, providers, HTTP, secrets, config, history,
  consent, logging, clock.
- `context`: diff normalization, classification, grouping, ranking, token
  budgeting, trimming.
- `security`: redaction, sensitive paths, URL policy, output sanitizing,
  injection guards.
- `message`: prompts, parsing, repair, Conventional Commits validation,
  grounding, fallback, trailers.
- `summary`: chunk planning, summarization, aggregation, cache.
- `product`: placeholder identity used by every layer.

`tsconfig.core.json` compiles this folder with `"types": []`. A test fails if a
core file imports `vscode`, `node:*`, or calls `fetch`.

### Adapters

| Folder | Responsibility |
| --- | --- |
| `git/` | Git API activation, repository resolution, diff collection, SCM writer |
| `providers/` | Wire dialects, adapters, HTTP client, retries, model catalog |
| `config/` | Settings, profiles, secrets wiring, consent, settings controller |
| `secrets/` | SecretStorage wrapper and fingerprints |
| `commands/` | Command registration and the generation orchestrator |
| `ui/` | Sidebar webview, dialogs, status bar, progress, output channel |
| `logging/` | Redacting output channel |

## Data flow

```
command
  -> resolve repository (editor, SCM selection, picker)
  -> resolve profile and privacy policy
  -> collect changes (staged / unstaged / untracked)
  -> classify, group, rank
  -> budget and trim diffs
  -> build manifest + change overview
  -> optional chunk summaries (map-reduce)
  -> prompt (untrusted diff delimiters)
  -> HTTP choke point (redaction, URL policy, timeout, abort)
  -> parse, repair, validate Conventional Commits
  -> grounding warnings
  -> SCM input box (never commit)
```

## Key contracts

- `IDiffCollector` produces a `ChangeSet` and reports omissions.
- `AIProvider` hides wire format behind `generate` and `listModels`.
- `IHttpClient` is the only transport; it enforces security.
- `IMessageWriter` is the only writer of the SCM input box.
- `ISecretStore` is the only credential source.
- `IConsentService` gates first contact with a provider origin.

## Provider abstraction

Three wire dialects plus a session-based adapter:

| Dialect | Used by |
| --- | --- |
| `openai-chat` | OpenAI, DeepSeek, OpenRouter, LM Studio, llama.cpp, vLLM, custom |
| `anthropic-messages` | Anthropic, custom |
| `gemini-generate` | Google Gemini, custom |
| `ollama-native` | Ollama |
| `opencode-session` | OpenCode local server |

Auth is resolved once into headers by `AuthResolver`; adapters never see raw
keys. Errors are normalized into a single taxonomy so retry and UI behavior are
consistent.

## Context engine

1. **Classification**: source, test, docs, config, lockfile, generated, binary,
   asset, other; importance is tracked per file.
2. **Grouping**: monorepo package first, then top-level directory.
3. **Ranking**: status weight, churn, source over generated, tests lower.
4. **Budgeting**: manifest always included; per-file water-filling; explicit
   `lines omitted` markers.
5. **Map-reduce**: chunks are group-scoped; each chunk is summarized with retry
   and cache; aggregation preserves failed chunks as `[not analyzed: ...]`.
6. **Reporting**: coverage and limitations reach the user.

Modes: Quick (single request), Smart (adaptive), Detailed (forced deep analysis
for more than one file).

## Security choke points

| Control | Location |
| --- | --- |
| Redaction | `core/security/secret-redactor.ts`, applied by `http/redacting-http-client.ts` |
| URL policy | `core/security/url-policy.ts`, used by profile resolution |
| Sensitive paths | `core/security/sensitive-path-policy.ts`, used by the diff collector |
| Logging | `logging/redacting-logger.ts` |
| Credentials | `secrets/secret-store.ts` and `providers/auth-resolver.ts` |
| Untrusted diffs | `security/injection-guard.ts` and prompt builders |
| No commit | absence of Git mutation calls; enforced by tests |

## Invariants

1. Never commit, stage, amend or restore.
2. Keys only in SecretStorage.
3. One writer for the SCM input box.
4. One HTTP layer.
5. Diff content is data.
6. No shell execution.
7. No telemetry.
8. No TLS validation bypass.
9. No silent truncation.

Each invariant has an automated check under `test/architecture` or
`test/audit`.

## Testing

- Unit: pure core plus adapters with mocks.
- Contract: provider dialects against recorded responses.
- Integration: temporary real Git repositories.
- E2E: activation, command registration, webview registration.
- Audit: 200 and 1200 file plans, failures, cancellation, security.
- Architecture: layering, invariants, product identity.

## Extension points

- New provider: add an id, a preset, optionally a dialect, a mocked test.
- New mode: extend `ModePreset` and the mode list; update docs.
- New output format: extend the message composer and validator.

## Trade-offs

- No streaming UI: simpler, cancellable, avoids fighting the SCM input box.
- Native webview only for the sidebar; everything else uses QuickPick/InputBox.
- No proxy support in 1.0; documented limitation.
- Zero runtime dependencies to keep the supply chain small.
