# Privacy

CommitWriter is designed so that you can see exactly what leaves your machine and choose where it goes.

## Summary

- CommitWriter has **no telemetry** and operates no servers.
- It sends data **only when you run a generation or connection test**.
- It sends only the changes you selected, within your configured budget.
- It redacts credentials and blocks sensitive files before sending.
- API keys are stored in the OS keychain through VS Code SecretStorage.
- You can enforce a fully local setup with Local-only mode.

## What is collected

Nothing. Version 1 does not collect usage data, crash reports, identifiers, or file paths.

## What is sent

When you run a command that contacts a provider, CommitWriter sends:

- A manifest of the analysed files: path, status, insertion and deletion counts.
- A diff or chunk summaries for selected files, within the token budget.
- System and user prompts describing the task and output format.
- The model id and generation parameters.

Recipients:

- The provider and endpoint of your active profile.
- For OpenCode, the local OpenCode server, which may forward the request to the provider configured inside OpenCode.

No unchanged files are sent. No file outside the selected change set is read for the prompt.

## Redaction

Before serialization, the payload is scanned for:

- Private key blocks.
- AWS, GitHub, Slack, Google and OpenAI-style keys.
- JWTs and bearer tokens.
- Password, secret, token and access-key assignments.
- Credentials embedded in connection strings.
- High-entropy strings that resemble secrets.

Matches are replaced with placeholders. Over-redaction is preferred over disclosure.

## Sensitive files

These are excluded from prompts by default:

- `.env` and variants, `.envrc`
- `.pem`, `.key`, `.p12`, `.pfx`, keystores
- `id_rsa`, `id_ed25519` and other private keys
- `.ssh/`, `.aws/`, `.azure/`, `.docker/config.json`
- `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`
- `secrets/`, `credentials`, service-account keys

A one-run override is available through a command that displays a warning. The override is never persisted.

## Local-only mode

Enable `commitwriter.privacy.localOnly` to reject every non-loopback endpoint. With this enabled, only local servers on `127.0.0.1`, `localhost` or `::1` can be used. This is suitable for offline and air-gapped work.

## Consent

The first request to each provider origin requires an explicit confirmation that names the host, provider, model and estimated token count. Consent is stored locally, can be reviewed, and can be revoked with **CommitWriter: Revoke Egress Consent**. Changing a profile's base URL requires consent again. OpenCode consent names the provider and model it will forward to.

## What is stored locally

| Data | Location |
| --- | --- |
| API keys and OpenCode passwords | VS Code SecretStorage (OS keychain) |
| Provider profiles and settings | VS Code user settings, machine scope |
| Egress consent records | VS Code global state |
| Chunk summary cache | In memory only, cleared when VS Code exits |
| Logs | Local output channel: counts, durations, ids; never prompts or diffs |

## Retention by providers

CommitWriter does not control what a provider stores or how it uses the data. Review the privacy policy of the provider you configure. Local servers keep data on your machine; OpenCode forwards requests according to its own configuration.

## Contact

For privacy questions, open an issue at `https://github.com/malikrajat/CommitWriter/issues`. For security reports, follow [SECURITY.md](SECURITY.md).


