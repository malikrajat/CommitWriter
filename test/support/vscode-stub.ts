/**
 * Minimal runtime stub for the `vscode` module, used by node-based smoke tests.
 * It implements only the surface CommitWriter touches at activation time.
 */

type Handler = (...args: unknown[]) => unknown;

export const created = { statusBars: 0, outputChannels: 0, treeViews: 0, webviewViews: 0 };

export const extensionState: { current: unknown } = { current: undefined };

export function setExtension(value: unknown): void {
  extensionState.current = value;
}

export function setActiveTextEditor(editor: unknown): void {
  (window as unknown as { activeTextEditor: unknown }).activeTextEditor = editor;
}

const registered = new Map<string, Handler>();

const settings = new Map<string, unknown>();

export function resetSettings(): void {
  settings.clear();
}

export function readSettings(): ReadonlyMap<string, unknown> {
  return settings;
}

function scopedConfiguration(section: string) {
  const prefix = section.length > 0 ? `${section}.` : '';
  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      const full = `${prefix}${key}`;
      return settings.has(full) ? (settings.get(full) as T) : defaultValue;
    },
    inspect(): unknown {
      return {};
    },
    async update(key: string, value: unknown): Promise<void> {
      const full = `${prefix}${key}`;
      if (value === undefined) {
        settings.delete(full);
      } else {
        settings.set(full, value);
      }
    },
  };
}

const channel = {
  name: 'CommitWriter',
  append: () => undefined,
  appendLine: () => undefined,
  replace: () => undefined,
  clear: () => undefined,
  show: () => undefined,
  hide: () => undefined,
  dispose: () => undefined,
};

function statusItem() {
  return {
    text: '',
    tooltip: '',
    command: '',
    show: () => undefined,
    hide: () => undefined,
    dispose: () => undefined,
  };
}

export const window = {
  createOutputChannel: () => {
    created.outputChannels += 1;
    return channel;
  },
  createStatusBarItem: () => {
    created.statusBars += 1;
    return statusItem();
  },
  createTreeView: () => {
    created.treeViews += 1;
    return {
      onDidChangeCheckboxState: () => ({ dispose: () => undefined }),
      onDidChangeSelection: () => ({ dispose: () => undefined }),
      dispose: () => undefined,
      reveal: async () => undefined,
    };
  },
  registerWebviewViewProvider: () => {
    created.webviewViews += 1;
    return { dispose: () => undefined };
  },
  withProgress: async (
    _options: unknown,
    task: (progress: unknown, token: unknown) => unknown,
  ): Promise<unknown> =>
    task({ report: () => undefined }, { onCancellationRequested: () => ({ dispose: () => undefined }) }),
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showQuickPick: async () => undefined,
  showInputBox: async () => undefined,
  showTextDocument: async () => undefined,
  activeTextEditor: undefined,
};

export const workspace = {
  getConfiguration: (section = '') => scopedConfiguration(section),
  onDidChangeConfiguration: () => ({ dispose: () => undefined }),
  openTextDocument: async () => ({}),
  isTrusted: true,
  workspaceFolders: [] as unknown[],
};

export const commands = {
  registered,
  registerCommand: (id: string, handler: Handler) => {
    registered.set(id, handler);
    return {
      dispose: () => {
        registered.delete(id);
      },
    };
  },
  executeCommand: async () => undefined,
};

export const extensions = {
  getExtension: () => extensionState.current,
};

export const env = {
  language: 'en',
  appName: 'Visual Studio Code',
  clipboard: { writeText: async () => undefined },
};

export const StatusBarAlignment = { Left: 1, Right: 2 };
export const ProgressLocation = { Notification: 15 };
export const ConfigurationTarget = { Global: 1, Workspace: 2 };

export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
export const TreeItemCheckboxState = { Unchecked: 0, Checked: 1 };

export class TreeItem {
  id?: string;
  description?: string;
  tooltip?: unknown;
  iconPath?: unknown;
  checkboxState?: number;
  command?: unknown;
  contextValue?: string;

  constructor(
    public label: string,
    public collapsibleState?: number,
  ) {}
}

export class ThemeIcon {
  constructor(public readonly id: string) {}
}

export class EventEmitter<T = unknown> {
  readonly event = (_listener: (value: T) => unknown) => ({ dispose: () => undefined });
  fire(_value: T): void {
    return undefined;
  }
  dispose(): void {
    return undefined;
  }
}

export const Uri = {
  file: (fsPath: string) => ({ fsPath, scheme: 'file', toString: () => fsPath }),
};

export default { window, workspace, commands, extensions, env };

