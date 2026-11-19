import type { GitRepository } from './git-types.js';

export interface GitCapabilities {
  readonly shortStats: boolean;
  readonly worktrees: boolean;
  readonly kind: boolean;
  readonly virtualFileSystem: boolean;
}

/**
 * Older VS Code releases miss members that were added over time. Everything
 * optional is probed once at activation instead of assumed.
 */
export function probeCapabilities(repository: GitRepository): GitCapabilities {
  return {
    shortStats: typeof repository.diffWithHEADShortStats === 'function',
    worktrees: typeof (repository as unknown as { state?: { worktrees?: unknown } }).state?.worktrees !== 'undefined',
    kind: typeof (repository as unknown as { kind?: unknown }).kind === 'string',
    virtualFileSystem: repository.isUsingVirtualFileSystem === true,
  };
}
