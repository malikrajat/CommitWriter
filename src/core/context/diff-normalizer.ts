import type { DiffHunk } from '../domain/diff-hunk.js';

export interface ParsedDiff {
  readonly hunks: readonly DiffHunk[];
  readonly insertions: number;
  readonly deletions: number;
  readonly isBinary: boolean;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;
const BINARY_MARKER = /GIT binary patch|^Binary files .* differ$/m;

/**
 * Parses a unified diff into hunks. Tolerant of extra git headers
 * (`diff --git`, `index`, `---`, `+++`, rename metadata).
 */
export function parseUnifiedDiff(text: string): ParsedDiff {
  if (text.trim().length === 0) {
    return { hunks: [], insertions: 0, deletions: 0, isBinary: false };
  }

  const isBinary = BINARY_MARKER.test(text);
  const lines = text.split(/\r?\n/);
  const hunks: DiffHunk[] = [];
  let insertions = 0;
  let deletions = 0;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const match = HUNK_HEADER.exec(line);
    if (!match) {
      index += 1;
      continue;
    }

    const hunk: DiffHunk = {
      header: line,
      oldStart: Number(match[1]),
      oldLines: match[2] === undefined ? 1 : Number(match[2]),
      newStart: Number(match[3]),
      newLines: match[4] === undefined ? 1 : Number(match[4]),
      lines: [],
    };
    const body: string[] = [];
    index += 1;

    while (index < lines.length) {
      const bodyLine = lines[index];
      if (HUNK_HEADER.test(bodyLine) || bodyLine.startsWith('diff --git ')) {
        break;
      }
      if (bodyLine.startsWith('\\')) {
        index += 1;
        continue;
      }
      if (bodyLine.length === 0 && index === lines.length - 1) {
        break;
      }
      body.push(bodyLine);
      if (bodyLine.startsWith('+')) {
        insertions += 1;
      } else if (bodyLine.startsWith('-')) {
        deletions += 1;
      }
      index += 1;
    }

    hunks.push({ ...hunk, lines: body });
  }

  return { hunks, insertions, deletions, isBinary };
}
