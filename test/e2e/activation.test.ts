import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { activate, deactivate } from '../../src/extension.js';
import { created } from '../support/vscode-stub.js';

interface Manifest {
  contributes: { commands: Array<{ command: string }> };
  activationEvents: string[];
  engines: { vscode: string };
}

function makeContext(): vscode.ExtensionContext {
  const secrets = new Map<string, string>();
  const state = new Map<string, unknown>();
  return {
    subscriptions: [],
    secrets: {
      get: async (key: string) => secrets.get(key),
      store: async (key: string, value: string) => {
        secrets.set(key, value);
      },
      delete: async (key: string) => {
        secrets.delete(key);
      },
      onDidChange: () => ({ dispose: () => undefined }),
    },
    globalState: {
      get: (key: string, defaultValue?: unknown) => state.get(key) ?? defaultValue,
      update: async (key: string, value: unknown) => {
        state.set(key, value);
      },
      keys: () => [...state.keys()],
      setKeysForSync: () => undefined,
    },
    workspaceState: {
      get: (_key: string, defaultValue?: unknown) => defaultValue,
      update: async () => undefined,
      keys: () => [],
    },
    extensionUri: vscode.Uri.file('D:/extension') as unknown as vscode.Uri,
    extensionPath: 'D:/extension',
    extension: { packageJSON: { version: '1.0.0' } },
    globalStorageUri: vscode.Uri.file('D:/storage') as unknown as vscode.Uri,
    asAbsolutePath: (relative: string) => path.join('D:/extension', relative),
  } as unknown as vscode.ExtensionContext;
}

async function readManifest(): Promise<Manifest> {
  const raw = await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  return JSON.parse(raw) as Manifest;
}

beforeEach(() => {
  created.outputChannels = 0;
  created.statusBars = 0;
  created.treeViews = 0;
  created.webviewViews = 0;
});

afterEach(() => {
  deactivate();
});

describe('extension activation', () => {
  it('registers exactly the commands declared in package.json', async () => {
    const manifest = await readManifest();
    activate(makeContext());

    const registry = (vscode.commands as unknown as { registered: Map<string, unknown> }).registered;
    const registeredIds = [...registry.keys()].sort();
    const declaredIds = manifest.contributes.commands.map((entry) => entry.command).sort();

    expect(registeredIds).toEqual(declaredIds);
    expect(declaredIds.length).toBeGreaterThanOrEqual(15);
  });

  it('creates the output channel, status bar and sidebar view without throwing', () => {
    activate(makeContext());
    expect(created.outputChannels).toBeGreaterThanOrEqual(1);
    expect(created.statusBars).toBe(1);
    expect(created.webviewViews).toBe(1);
  });

  it('can be deactivated twice without throwing', () => {
    activate(makeContext());
    expect(() => {
      deactivate();
      deactivate();
    }).not.toThrow();
  });

  it('declares the approved runtime constraints', async () => {
    const manifest = await readManifest();
    expect(manifest.engines.vscode).toBe('^1.90.0');
    expect(manifest.activationEvents).toContain('onStartupFinished');
  });
});
