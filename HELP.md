# Help

Task-oriented help for CommitWriter. For the full reference see the
[README](README.md), and for problems see [Support](SUPPORT.md).

## Install and open

1. Install **CommitWriter** (`malikrajat.commitwriter`) or the VSIX.
2. Reload the window.
3. Click the CommitWriter icon in the Activity Bar. The sidebar opens.

If the Extensions page shows "AI Code Review Export for ChatGPT, Claude,
Gemini", that is a different extension named DiffScribe. Uninstall it and install
CommitWriter.

## Create your first message

1. Stage the files you want to commit.
2. Open the sidebar and choose **Add provider**.
3. Enter the base URL, API key and model. For local models, pick Ollama, LM
   Studio, llama.cpp or vLLM; no key is needed.
4. Run **Generate commit message**.
5. Review the text in the Source Control input box, edit if needed, and commit
   yourself.

## Which mode should I use?

| Mode | Choose it when |
| --- | --- |
| Quick | You want a subject line fast, with one request. |
| Smart | Normal use; it adapts to the size of the diff. |
| Detailed | Many files, mixed areas, or you want a richer body. |

## Which changes are sent?

Only the toggles enabled under **What to include**:

- Staged changes (default on)
- Unstaged changes (default off)
- Untracked files (default off)

Nothing else is read for the prompt. The manifest lists every analysed file and
every omission is reported.

## Local and offline use

1. Start Ollama, LM Studio, llama.cpp or vLLM.
2. Add the matching local provider.
3. Enable **Local-only mode**.

With Local-only mode, cloud endpoints are rejected. No data leaves the machine
except to the local server.

## Keep API keys safe

Keys are stored in the OS keychain through VS Code SecretStorage. They are never
written to `settings.json`, logs, or telemetry. To replace a key, use **Set API
key** for that profile.

## Common problems

| Problem | Solution |
| --- | --- |
| "No staged changes" | Stage files, or enable unstaged/untracked analysis. |
| 401 / 403 | Re-enter the API key for the active profile. |
| 429 | Wait, lower the token budget, or switch profile. |
| Model not found | Use **Select Model** or correct the model id. |
| Local server refused | Start the server and check the port. |
| Message too generic | Use Detailed mode, stage fewer files, raise the budget. |
| Details page shows another product | You installed DiffScribe, not CommitWriter. |
| Sidebar looks empty | Reload the window once after installing. |

## Undo and regenerate

- **Undo last generated message** restores the previous input-box text.
- **Regenerate** retries with the same change snapshot.
- If the model fails, choose **Use Local Fallback** for a deterministic message.

## Privacy questions

See [PRIVACY.md](PRIVACY.md). For security reports, see
[SECURITY.md](SECURITY.md).
