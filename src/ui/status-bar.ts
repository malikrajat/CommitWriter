import * as vscode from 'vscode';
import { PRODUCT } from '../core/product.js';
import type { GenerationMode } from '../core/domain/generation-mode.js';

export class StatusBar {
  private readonly item: vscode.StatusBarItem;
  private mode: GenerationMode = 'smart';
  private profile = '';
  private model = '';
  private busy = false;
  private enabled: boolean;

  constructor(enabled: boolean) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
    this.item.command = PRODUCT.command.generate;
    this.enabled = enabled;
    if (enabled) {
      this.item.show();
    }
    this.render();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      this.item.show();
    } else {
      this.item.hide();
    }
  }

  set(mode: GenerationMode, profile: string, model?: string): void {
    this.mode = mode;
    this.profile = profile;
    this.model = model ?? '';
    this.render();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.render();
  }

  private render(): void {
    if (this.busy) {
      this.item.text = `$(sync~spin) ${PRODUCT.displayName}`;
      this.item.tooltip = 'Generating a commit message...';
      return;
    }
    const label = this.profile.length > 0 ? `${this.mode} | ${this.profile}` : this.mode;
    this.item.text = `$(git-commit) ${PRODUCT.displayName}: ${label}`;
    const model = this.model.length > 0 ? ` | ${this.model}` : '';
    this.item.tooltip = `Generate a commit message (${this.mode} | ${this.profile}${model})`;
  }

  dispose(): void {
    this.item.dispose();
  }
}
