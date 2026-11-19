# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.0.x | Yes |

## Reporting a vulnerability

Please do not open a public issue for security problems. Use a private security advisory on the project repository:

`https://github.com/malikrajat/CommitWriter/security/advisories/new`

Include the affected version, a short description, reproduction steps, and the impact you observed. You will receive an acknowledgement, and a fix will be prepared before any public disclosure.

## Security model

CommitWriter handles source code, credentials, and outbound network requests, so the following guarantees are treated as invariants. They are enforced by code structure and by automated tests.

| Invariant | Enforcement |
| --- | --- |
| The extension never executes a Git commit, stage, amend or restore operation | The SCM writer is the only component allowed to touch the input box, and Git mutation APIs are never imported |
| API keys are never stored in normal settings | Keys live in VS Code SecretStorage; the profile schema rejects an `apiKey` field |
| Only the commit-message writer can modify the Source Control input box | Single-writer architecture rule with an automated check |
| All external traffic goes through one HTTP layer | A single transport implementation applies redaction, URL policy, timeouts and cancellation |
| Diff content is untrusted data | Diffs are wrapped in explicit delimiters, tag-closing sequences are neutralized, and instruction-like content is reported as a warning |
| No arbitrary shell execution | No `child_process`, `spawn`, `exec` or shell invocation anywhere in the extension |
| No telemetry | No analytics or telemetry APIs are used |
| TLS validation is never disabled | No `rejectUnauthorized`, `NODE_TLS_REJECT_UNAUTHORIZED` or equivalent option exists |

## Threat model

### Credential theft through repository settings

A malicious repository could try to redirect a trusted profile to an attacker-controlled endpoint and capture the stored key.

Mitigation: provider profiles are machine-scoped and cannot be set from workspace settings. The active profile is validated against the URL policy before credentials are attached. Changing a base URL invalidates consent for the new origin.

### Credential leakage through logs or errors

Provider error bodies, prompts, headers and diffs are never written to logs. Error messages expose only normalized codes, status codes, provider and model ids. Error details from providers are redacted before they are retained.

### Secret disclosure to a third-party model

Before any request is serialized, the payload passes through a redaction stage that removes private keys, cloud keys, GitHub and Slack tokens, JWTs, bearer tokens, password assignments and credential-bearing connection strings. Sensitive paths (`.env`, key material, `.ssh`, `.aws`, credential stores) are excluded by default.

### Prompt injection from diff content

Repository content is data. The prompt wraps each diff in `<untrusted_diff>` delimiters, neutralizes closing tags inside the content, and the output is parsed and validated as a commit message, never executed.

### Network interception

Remote endpoints must use HTTPS. Plain HTTP is accepted only for loopback addresses used by local model servers. Redirects are not followed, and certificate validation cannot be disabled.

### Supply chain

Version 1 ships with zero runtime dependencies. The bundled extension is a single file produced from this repository.

## Out of scope

- Retention, logging or model training performed by the AI provider you configure.
- A compromised local machine, VS Code installation, or other installed extensions.
- Denial of service through extremely large repositories beyond the configured limits.
- Credentials deliberately pasted into a diff that the redaction stage cannot recognize.

## User responsibilities

- Protect your provider API keys and rotate them if exposed.
- Review the generated message before committing.
- Use Local-only mode for confidential code when appropriate.
- Keep VS Code updated.


