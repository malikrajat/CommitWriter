import type { PromptSegment } from '../domain/budget.js';
import type { FileChange } from '../domain/file-change.js';

export interface TrimmedLines {
  readonly lines: readonly string[];
  readonly omitted: number;
}

/**
 * Keeps the head and tail of a diff, dropping the middle. Truncation is always
 * explicit: the omitted line count is reported to the user.
 */
export function trimLines(lines: readonly string[], maxLines: number): TrimmedLines {
  if (lines.length <= maxLines) {
    return { lines, omitted: 0 };
  }
  const keep = Math.max(4, maxLines);
  if (keep >= lines.length) {
    return { lines, omitted: 0 };
  }
  const head = Math.floor(keep / 2);
  const tail = keep - head;
  const omitted = lines.length - keep;
  return {
    lines: [
      ...lines.slice(0, head),
      `... ${omitted} lines omitted ...`,
      ...lines.slice(lines.length - tail),
    ],
    omitted,
  };
}

export function toSegment(file: FileChange, maxLines: number): PromptSegment {
  const flattened = file.hunks.flatMap((hunk) => [hunk.header, ...hunk.lines]);
  const trimmed = trimLines(flattened, maxLines);
  return {
    path: file.path,
    status: file.status,
    staged: file.staged,
    insertions: file.insertions,
    deletions: file.deletions,
    omittedLines: file.omittedLines + trimmed.omitted,
    lines: trimmed.lines,
  };
}

export function segmentText(segment: PromptSegment): string {
  return segment.lines.join('\n');
}
