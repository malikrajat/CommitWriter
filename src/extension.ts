import type * as vscode from 'vscode';
import { createContainer } from './container.js';

let dispose: (() => void) | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const container = createContainer(context);
  container.host.register(context);
  context.subscriptions.push({ dispose: () => container.dispose() });
  dispose = () => container.dispose();
}

export function deactivate(): void {
  dispose?.();
  dispose = undefined;
}
