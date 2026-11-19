import type { FileChange } from '../domain/file-change.js';
import type { FileCategory } from '../context/file-classifier.js';
import { classifyFile } from '../context/file-classifier.js';
import { groupChanges } from '../context/change-grouper.js';

export interface BriefGroup {
  readonly key: string;
  readonly files: readonly string[];
  readonly insertions: number;
  readonly deletions: number;
  readonly categories: readonly FileCategory[];
}

export interface ChangeCounts {
  readonly files: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly added: number;
  readonly modified: number;
  readonly deleted: number;
  readonly renamed: number;
  readonly tests: number;
  readonly docs: number;
}

export interface ChangeBrief {
  readonly primary?: BriefGroup;
  readonly secondary: readonly BriefGroup[];
  /** Every analyzed path, used for grounding checks. */
  readonly paths: readonly string[];
  /** Conventional Commit scope candidates derived from top-level areas. */
  readonly scopeCandidates: readonly string[];
  readonly counts: ChangeCounts;
  readonly categories: Readonly<Partial<Record<FileCategory, number>>>;
}

function groupScore(files: readonly FileChange[], insertions: number, deletions: number): number {
  const important = files.filter((file) => classifyFile(file).important).length;
  return important * 20 + insertions + deletions;
}

function scopeForGroup(key: string): string | undefined {
  if (key === '(root)') {
    return undefined;
  }
  const parts = key.split('/');
  return (parts[parts.length - 1] ?? key).replace(/[^a-zA-Z0-9._-]/g, '');
}

export function buildChangeBrief(files: readonly FileChange[]): ChangeBrief {
  const groups = groupChanges(files);
  const summaries: BriefGroup[] = groups.map((group) => ({
    key: group.key,
    files: group.files.map((file) => file.path).sort((a, b) => (a < b ? -1 : 1)),
    insertions: group.insertions,
    deletions: group.deletions,
    categories: [...new Set(group.files.map((file) => classifyFile(file).category))],
  }));

  const ranked = groups
    .map((group, index) => ({
      summary: summaries[index]!,
      score: groupScore(group.files, group.insertions, group.deletions),
    }))
    .sort((a, b) => (a.score !== b.score ? b.score - a.score : a.summary.key < b.summary.key ? -1 : 1))
    .map((entry) => entry.summary);

  const categories: Partial<Record<FileCategory, number>> = {};
  let insertions = 0;
  let deletions = 0;
  let added = 0;
  let modified = 0;
  let deleted = 0;
  let renamed = 0;
  let tests = 0;
  let docs = 0;

  for (const file of files) {
    const classification = classifyFile(file);
    categories[classification.category] = (categories[classification.category] ?? 0) + 1;
    insertions += file.insertions;
    deletions += file.deletions;
    if (file.status === 'added' || file.status === 'untracked') {
      added += 1;
    }
    if (file.status === 'modified') {
      modified += 1;
    }
    if (file.status === 'deleted') {
      deleted += 1;
    }
    if (file.status === 'renamed') {
      renamed += 1;
    }
    if (classification.category === 'test') {
      tests += 1;
    }
    if (classification.category === 'documentation') {
      docs += 1;
    }
  }

  const scopeCandidates = [
    ...new Set(
      summaries
        .map((group) => scopeForGroup(group.key))
        .filter((scope): scope is string => scope !== undefined && scope.length > 0),
    ),
  ].slice(0, 8);

  return {
    primary: ranked[0],
    secondary: ranked.slice(1, 6),
    paths: files.map((file) => file.path).sort((a, b) => (a < b ? -1 : 1)),
    scopeCandidates,
    counts: {
      files: files.length,
      insertions,
      deletions,
      added,
      modified,
      deleted,
      renamed,
      tests,
      docs,
    },
    categories,
  };
}

export function formatChangeBrief(brief: ChangeBrief): string {
  const lines: string[] = ['<change_overview>'];
  if (brief.primary) {
    lines.push(
      `Primary area: ${brief.primary.key} (${brief.primary.files.length} file${brief.primary.files.length === 1 ? '' : 's'}, +${brief.primary.insertions} -${brief.primary.deletions})`,
    );
  }
  if (brief.secondary.length > 0) {
    lines.push(`Secondary areas: ${brief.secondary.map((group) => group.key).join(', ')}`);
  }
  lines.push(
    `Change kinds: added ${brief.counts.added}, modified ${brief.counts.modified}, deleted ${brief.counts.deleted}, renamed ${brief.counts.renamed}`,
  );
  if (brief.scopeCandidates.length > 0) {
    lines.push(`Scope candidates: ${brief.scopeCandidates.join(', ')}`);
  }
  lines.push('Only these areas and the files in <change_manifest> may be named in the message.');
  lines.push('</change_overview>');
  return lines.join('\n');
}
