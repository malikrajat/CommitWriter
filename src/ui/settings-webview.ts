import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { PRODUCT } from '../core/product.js';
import type { IConfig, IProfileService } from '../core/ports/i-config.js';
import type { ProviderProfile } from '../core/domain/provider-profile.js';
import {
  buildSettingsModel,
  isToggleKey,
  type SettingsViewModel,
} from './settings-model.js';

export const VIEW_ID = `${PRODUCT.id}.settings`;

const ALLOWED_COMMANDS = new Set<string>([
  'workbench.action.openSettings',
]);

export interface SettingsWebviewDeps {
  readonly config: IConfig;
  readonly profiles: IProfileService;
}

export class SettingsWebviewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly deps: SettingsWebviewDeps,
    private readonly extensionVersion: string,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.renderShell(this.buildModel([]));

    const subscription = view.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message);
    });
    view.onDidDispose(() => subscription.dispose());
  }

  refresh(): void {
    void this.refreshAsync();
  }

  private async refreshAsync(): Promise<void> {
    if (!this.view) {
      return;
    }
    const profiles = await this.deps.profiles.list();
    await this.view.webview.postMessage({ type: 'model', model: this.buildModel(profiles) });
  }

  private buildModel(profiles: readonly ProviderProfile[]): SettingsViewModel {
    const config = this.deps.config.read();
    const activeId = vscode.workspace
      .getConfiguration(PRODUCT.configSection)
      .get<string>('activeProfileId', '');
    const base = buildSettingsModel(config, profiles, activeId);
    return {
      ...base,
      footer: `${base.footer} Version ${this.extensionVersion}.`,
    };
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (typeof message !== 'object' || message === null) {
      return;
    }
    const record = message as Record<string, unknown>;
    const type = record['type'];

    if (type === 'ready') {
      this.refresh();
      return;
    }

    if (type === 'toggle') {
      const key = record['key'];
      if (!isToggleKey(key)) {
        return;
      }
      const value = record['value'] === true;
      await vscode.workspace
        .getConfiguration(PRODUCT.configSection)
        .update(key, value, vscode.ConfigurationTarget.Global);
      this.refresh();
      return;
    }

    if (type === 'command') {
      const command = record['command'];
      if (typeof command !== 'string') {
        return;
      }
      const allowed = command.startsWith(`${PRODUCT.id}.`) || ALLOWED_COMMANDS.has(command);
      if (!allowed) {
        return;
      }
      const args = Array.isArray(record['args']) ? record['args'] : [];
      await vscode.commands.executeCommand(command, ...args);
      this.refresh();
    }
  }

  private renderShell(model: SettingsViewModel): string {
    const nonce = createNonce();
    const initial = JSON.stringify(model).replace(/</g, '\\u003c');
    const csp = [
      "default-src 'none'",
      `style-src 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
      "img-src 'none'",
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(model.title)}</title>
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0 0 24px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
  }
  header { padding: 16px 16px 8px; }
  h1 { margin: 0 0 4px; font-size: 15px; font-weight: 600; letter-spacing: 0.01em; }
  .subtitle { margin: 0; color: var(--vscode-descriptionForeground); font-size: 11.5px; line-height: 1.45; }
  .searchWrap { padding: 8px 16px 12px; position: sticky; top: 0; background: var(--vscode-sideBar-background); z-index: 2; }
  input[type="search"] {
    width: 100%;
    padding: 5px 8px;
    font-family: inherit;
    font-size: 12px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px;
    outline: none;
  }
  input[type="search"]:focus { border-color: var(--vscode-focusBorder); }
  main { padding: 0 12px; display: flex; flex-direction: column; gap: 14px; }
  section { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25)); border-radius: 6px; overflow: hidden; background: var(--vscode-sideBar-background); }
  .sectionHead { padding: 9px 12px 7px; background: var(--vscode-sideBarSectionHeader-background, transparent); border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.18)); }
  .sectionTitle { font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .sectionDesc { margin-top: 2px; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.4; }
  .item { display: flex; gap: 10px; align-items: flex-start; padding: 9px 12px; border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.12)); }
  .item:first-of-type { border-top: none; }
  .item:hover { background: var(--vscode-list-hoverBackground); }
  .text { flex: 1; min-width: 0; }
  .label { font-size: 12px; font-weight: 500; line-height: 1.35; }
  .desc { margin-top: 2px; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.4; }
  .value { margin-top: 3px; color: var(--vscode-textLink-foreground); font-size: 11px; word-break: break-word; }
  button.action {
    margin-top: 6px;
    padding: 3px 10px;
    font-family: inherit;
    font-size: 11px;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: none;
    border-radius: 3px;
    cursor: pointer;
  }
  button.action:hover { background: var(--vscode-button-hoverBackground); }
  button.action:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .switch { position: relative; width: 30px; height: 16px; flex: 0 0 auto; margin-top: 2px; }
  .switch input { opacity: 0; width: 0; height: 0; }
  .slider { position: absolute; inset: 0; background: var(--vscode-checkbox-background); border: 1px solid var(--vscode-checkbox-border, rgba(128,128,128,0.5)); border-radius: 10px; transition: background 120ms; }
  .slider::before { content: ""; position: absolute; width: 10px; height: 10px; left: 2px; top: 2px; background: var(--vscode-checkbox-foreground, #fff); border-radius: 50%; transition: transform 120ms; }
  .switch input:checked + .slider { background: var(--vscode-button-background); border-color: var(--vscode-button-background); }
  .switch input:checked + .slider::before { transform: translateX(14px); }
  .switch input:focus-visible + .slider { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  .empty { padding: 24px 16px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px; }
  footer { padding: 14px 16px 0; color: var(--vscode-descriptionForeground); font-size: 10.5px; line-height: 1.4; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(model.title)}</h1>
  <p class="subtitle">${escapeHtml(model.subtitle)}</p>
</header>
<div class="searchWrap">
  <input id="search" type="search" placeholder="${escapeHtml(model.searchPlaceholder)}" aria-label="Search settings" />
</div>
<main id="app"></main>
<footer id="footer"></footer>
<script nonce="${nonce}" type="application/json" id="initial-model">${initial}</script>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const footer = document.getElementById('footer');
  const search = document.getElementById('search');
  let model = JSON.parse(document.getElementById('initial-model').textContent);

  function matches(item, query) {
    const text = [item.label, item.description, item.value, item.command].join(' ').toLowerCase();
    return text.indexOf(query) !== -1;
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    app.textContent = '';
    footer.textContent = model.footer;
    let shown = 0;

    for (const section of model.sections) {
      const items = query ? section.items.filter((item) => matches(item, query)) : section.items;
      if (items.length === 0) continue;
      shown += items.length;

      const sectionEl = document.createElement('section');
      const head = document.createElement('div');
      head.className = 'sectionHead';
      const title = document.createElement('div');
      title.className = 'sectionTitle';
      title.textContent = section.title;
      const desc = document.createElement('div');
      desc.className = 'sectionDesc';
      desc.textContent = section.description;
      head.appendChild(title);
      head.appendChild(desc);
      sectionEl.appendChild(head);

      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'item';

        if (item.kind === 'toggle') {
          const control = document.createElement('label');
          control.className = 'switch';
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.checked = item.checked === true;
          input.setAttribute('aria-label', item.label);
          input.addEventListener('change', () => {
            vscode.postMessage({ type: 'toggle', key: item.settingKey, value: input.checked });
          });
          const slider = document.createElement('span');
          slider.className = 'slider';
          control.appendChild(input);
          control.appendChild(slider);
          row.appendChild(control);
        }

        const text = document.createElement('div');
        text.className = 'text';
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = item.label;
        const desc = document.createElement('div');
        desc.className = 'desc';
        desc.textContent = item.description;
        text.appendChild(label);
        text.appendChild(desc);

        if (item.value) {
          const value = document.createElement('div');
          value.className = 'value';
          value.textContent = item.value;
          text.appendChild(value);
        }

        if (item.kind === 'action') {
          const button = document.createElement('button');
          button.className = 'action';
          button.type = 'button';
          button.textContent = 'Open';
          button.setAttribute('aria-label', item.label);
          button.addEventListener('click', () => {
            vscode.postMessage({ type: 'command', command: item.command, args: item.args || [] });
          });
          text.appendChild(button);
        }

        row.appendChild(text);
        sectionEl.appendChild(row);
      }

      app.appendChild(sectionEl);
    }

    if (shown === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No setting matches "' + search.value.trim() + '".';
      app.appendChild(empty);
    }
  }

  search.addEventListener('input', render);
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'model') {
      model = event.data.model;
      render();
    }
  });
  render();
  vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createNonce(): string {
  return randomUUID().replace(/-/g, '');
}
