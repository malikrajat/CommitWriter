# Support

## Getting started

- [README](README.md) - features, install, providers, settings, FAQ
- [Help](HELP.md) - task-oriented answers and troubleshooting
- [Best practices](BEST_PRACTICES.md) - safe and cost-effective usage

## Before opening an issue

1. Run **CommitWriter: Show Diagnostics** and copy the summary.
2. Run **CommitWriter: Test Provider Connection** for the active profile.
3. Run **CommitWriter: Show Log** and check for error codes.
4. Confirm the extension version and VS Code version.

## Reporting a bug

Open an issue at:

`https://github.com/malikrajat/CommitWriter/issues`

Include:

- What you expected and what happened.
- Steps to reproduce.
- Extension version, VS Code version, operating system.
- Provider and model (never include the API key).
- Diagnostics output and redacted log lines.

Do not paste API keys, full diffs, or proprietary source code. The log is
designed to contain counts and error codes only.

## Feature requests

Describe the problem first, then the proposed behavior. Examples are welcome.
Features that weaken security guarantees (committing automatically, disabling
redaction, storing keys in settings) will not be accepted.

## Security issues

Do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Response expectations

This is a community project without a commercial SLA. Best effort is made to
respond to issues and pull requests, but no response time is guaranteed.

## Supported versions

| Version | Support |
| --- | --- |
| 1.0.x | Yes |
| Older | Upgrade to 1.0.x |
