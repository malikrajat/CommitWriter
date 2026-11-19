import type { ConventionalParts } from '../domain/commit-message.js';
import type { ChangeBrief } from './change-brief.js';

export interface GroundingInput {
  readonly subject: string;
  readonly conventional?: ConventionalParts;
  readonly body?: string;
  readonly brief: ChangeBrief;
}

const PATH_LIKE = /[A-Za-z0-9_@.-]+\/[A-Za-z0-9_@./-]+|\b[A-Za-z0-9_-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|cpp|hpp|c|h|rb|php|swift|scala|sh|sql|vue|svelte|astro|md|mdx|json|ya?ml|toml|lock)\b/g;

function stripSubjectPrefix(subject: string): string {
  return subject.replace(/^[a-zA-Z]+(?:\([^)]+\))?!?:\s+/, '');
}

function referencesExistingPath(token: string, paths: readonly string[]): boolean {
  const normalized = token.replace(/^\.\//, '').replace(/\/$/, '');
  return paths.some(
    (path) =>
      path === normalized ||
      path.endsWith(`/${normalized}`) ||
      path.endsWith(normalized) ||
      path.startsWith(`${normalized}/`),
  );
}

/**
 * Advisory checks that keep the message anchored to the actual change set.
 * Never rewrites content; returns human-readable warnings.
 */
export function validateGrounding(input: GroundingInput): readonly string[] {
  const warnings: string[] = [];
  const text = [stripSubjectPrefix(input.subject), input.body ?? ''].join('\n');
  const { counts, categories, paths } = input.brief;

  for (const match of text.matchAll(PATH_LIKE)) {
    const token = match[0];
    if (!referencesExistingPath(token, paths)) {
      warnings.push(`message references "${token}", which is not part of this change`);
    }
  }

  if (input.conventional?.type === 'docs' && (categories.documentation ?? 0) === 0) {
    warnings.push('type is "docs" but no documentation files changed');
  }
  if (input.conventional?.type === 'test' && (categories.test ?? 0) === 0) {
    warnings.push('type is "test" but no test files changed');
  }
  if (input.conventional?.type === 'perf' && counts.files === 0) {
    warnings.push('type is "perf" but no changes were analyzed');
  }

  const description = stripSubjectPrefix(input.subject).toLowerCase();
  if (counts.insertions === 0 && counts.added === 0 && counts.deleted > 0 && /\b(add|introduce|support|implement)\b/.test(description)) {
    warnings.push('message describes additions, but the change only deletes code');
  }
  if (counts.deletions === 0 && counts.deleted === 0 && /\b(remove|delete|drop)\b/.test(description)) {
    warnings.push('message describes removals, but nothing was deleted');
  }
  if (input.conventional?.type === 'feat' && counts.added === 0 && counts.insertions === 0 && counts.deleted > 0) {
    warnings.push('type is "feat", but the change only removes code');
  }

  return warnings;
}
