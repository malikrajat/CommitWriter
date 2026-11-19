import type { DiffPlan } from '../domain/budget.js';
import type { CommitMessage } from '../domain/commit-message.js';
import type { GenerationMode } from '../domain/generation-mode.js';

function commonScope(paths: readonly string[]): string | undefined {
  if (paths.length === 0) {
    return undefined;
  }
  const segments = paths.map((path) => path.split('/'));
  const first = segments[0];
  if (!first || first.length < 2) {
    return undefined;
  }
  const candidate = first[0];
  return segments.every((parts) => parts.length >= 2 && parts[0] === candidate) ? candidate : undefined;
}

/**
 * Deterministic, offline message used when the model output cannot be repaired.
 * It is offered to the user, never written automatically.
 */
export function heuristicMessage(plan: DiffPlan, mode: GenerationMode): CommitMessage {
  const fileCount = Math.max(plan.segments.length, plan.manifest.length);
  const paths = plan.segments.map((segment) => segment.path);
  const scope = commonScope(paths);
  const added = plan.segments.filter((segment) => segment.status === 'added' || segment.status === 'untracked').length;
  const deleted = plan.segments.filter((segment) => segment.status === 'deleted').length;

  const type = added > 0 && added === fileCount ? 'feat' : deleted > 0 && deleted === fileCount ? 'chore' : 'chore';
  const verb = added > 0 && added === fileCount ? 'add' : deleted > 0 && deleted === fileCount ? 'remove' : 'update';
  const noun = fileCount === 1 ? 'file' : 'files';
  const head = scope ? `${type}(${scope}):` : `${type}:`;
  const subject = `${head} ${verb} ${fileCount} ${noun}`;

  return {
    raw: subject,
    subject,
    footers: [],
    conventional: { type, scope, breaking: false, description: `${verb} ${fileCount} ${noun}` },
    warnings: ['generated locally from the file manifest (no AI output was used)'],
    provenance: { providerId: 'heuristic', model: 'manifest', strategy: 'heuristic', mode },
  };
}
