import * as vscode from 'vscode';
import { appError, type AppError } from '../core/domain/errors.js';
import { err, ok, type Result } from '../core/domain/result.js';
import { PRODUCT } from '../core/product.js';
import type { ILogger } from '../core/ports/i-logger.js';
import type { GitAPI, GitExtensionExports } from './git-types.js';

const INIT_TIMEOUT_MS = 15000;

function waitForInitialized(api: GitAPI, timeoutMs: number): Promise<boolean> {
  if (api.state === 'initialized') {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let subscription: { dispose(): void } | undefined;
    const timer = setTimeout(() => {
      subscription?.dispose();
      resolve(false);
    }, timeoutMs);
    subscription = api.onDidChangeState((state) => {
      if (state === 'initialized') {
        clearTimeout(timer);
        subscription?.dispose();
        resolve(true);
      }
    });
  });
}

export class GitApiProvider {
  private cached: GitAPI | undefined;

  constructor(
    private readonly logger: ILogger,
    private readonly initTimeoutMs: number = INIT_TIMEOUT_MS,
  ) {}

  async get(): Promise<Result<GitAPI, AppError>> {
    if (this.cached && this.cached.state === 'initialized') {
      return ok(this.cached);
    }

    const extension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
    if (!extension) {
      return err(appError('git_disabled', 'The built-in Git extension is not available.'));
    }

    if (!extension.isActive) {
      await extension.activate();
    }

    const exports = extension.exports;
    if (!exports || !exports.enabled) {
      return err(
        appError('git_disabled', `The built-in Git extension is disabled. Enable it to use ${PRODUCT.displayName}.`),
      );
    }

    const api = exports.getAPI(1);
    const initialized = await waitForInitialized(api, this.initTimeoutMs);
    if (!initialized) {
      return err(appError('no_repository', 'The Git extension did not finish initializing.'));
    }

    this.cached = api;
    this.logger.debug('git api ready', { repositories: api.repositories.length });
    return ok(api);
  }

  invalidate(): void {
    this.cached = undefined;
  }
}
