import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { ConfigService } from '../../../src/config/config-service.js';
import { PRODUCT } from '../../../src/core/product.js';
import { resetSettings } from '../../support/vscode-stub.js';

beforeEach(() => {
  resetSettings();
});

describe('ConfigService', () => {
  it('defaults to staged scope, smart mode and no local-only restriction', () => {
    const config = new ConfigService().read();
    expect(config.mode).toBe('smart');
    expect(config.context.includeStaged).toBe(true);
    expect(config.context.includeUnstaged).toBe(false);
    expect(config.context.includeUntracked).toBe(false);
    expect(config.privacy.localOnly).toBe(false);
    expect(config.provider.timeoutMs).toBe(120000);
  });

  it('reads the local-only privacy setting', async () => {
    await vscode.workspace
      .getConfiguration(PRODUCT.configSection)
      .update('privacy.localOnly', true, vscode.ConfigurationTarget.Global);
    expect(new ConfigService().read().privacy.localOnly).toBe(true);
  });

  it('reads per-mode overrides', async () => {
    await vscode.workspace
      .getConfiguration(PRODUCT.configSection)
      .update('modes.overrides', { quick: { maxDiffTokens: 1200 } }, vscode.ConfigurationTarget.Global);
    expect(new ConfigService().read().modeOverrides.quick?.maxDiffTokens).toBe(1200);
  });

  it('reads the independent change-selection flags', async () => {
    await vscode.workspace
      .getConfiguration(PRODUCT.configSection)
      .update('context.includeUnstaged', true, vscode.ConfigurationTarget.Global);
    await vscode.workspace
      .getConfiguration(PRODUCT.configSection)
      .update('context.includeUntracked', true, vscode.ConfigurationTarget.Global);
    const config = new ConfigService().read();
    expect(config.context.includeStaged).toBe(true);
    expect(config.context.includeUnstaged).toBe(true);
    expect(config.context.includeUntracked).toBe(true);
  });
});

