import { sanitizeCommitText, sanitizeText } from '../security/output-sanitizer.js';

export interface ParsedMessage {
  readonly subject: string;
  readonly body?: string;
  readonly footers: readonly string[];
}

const SUBJECT = /^([a-zA-Z][a-zA-Z0-9-]*)(?:\(([^)]+)\))?(!)?:\s+(.+)$/;
const FOOTER = /^(BREAKING[ -]CHANGE|Refs?|Closes|Fixes|Resolves|See also|Co-authored-by|Signed-off-by|Reviewed-by|[A-Z][A-Za-z-]+):\s/;

const PREAMBLE =
  /^(here(?:'s| is)|sure[,!]?|certainly[,!]?|commit message:|proposed commit message:|the commit message)/i;

/**
 * Extracts a subject/body/footers triple from raw model output.
 * Never throws; returns `subject: ''` when nothing usable is present.
 */
export function parseMessage(raw: string, maxSubjectLength = 72): ParsedMessage {
  const cleaned = sanitizeCommitText(sanitizeText(raw).replace(/^\uFEFF/, ''));
  const lines = cleaned.split('\n');
  if (lines.length === 0 || cleaned.trim().length === 0) {
    return { subject: '', footers: [] };
  }

  let subjectIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim().replace(/^\*\*|\*\*$/g, '').replace(/^["'`]|["'`]$/g, '');
    if (SUBJECT.test(line) && !PREAMBLE.test(line)) {
      subjectIndex = i;
      break;
    }
    if (i >= 6) {
      break;
    }
  }

  if (subjectIndex === -1) {
    // Fallback: first non-empty line, truncated to the subject limit.
    const first = lines.find((line) => line.trim().length > 0);
    if (!first) {
      return { subject: '', footers: [] };
    }
    return { subject: first.trim().slice(0, maxSubjectLength), footers: [] };
  }

  const subject = lines[subjectIndex]
    .trim()
    .replace(/^\*\*|\*\*$/g, '')
    .replace(/^["'`]|["'`]$/g, '');
  const rest = lines.slice(subjectIndex + 1);

  const bodyLines: string[] = [];
  const footerLines: string[] = [];
  let inFooters = false;

  for (const line of rest) {
    if (!inFooters && FOOTER.test(line.trim())) {
      inFooters = true;
    }
    if (inFooters) {
      if (line.trim().length > 0) {
        footerLines.push(line.trim());
      }
    } else {
      bodyLines.push(line);
    }
  }

  const body = bodyLines.join('\n').trim();
  return {
    subject,
    body: body.length > 0 ? body : undefined,
    footers: footerLines,
  };
}

export function looksLikeSubject(line: string): boolean {
  return SUBJECT.test(line.trim());
}

export function splitSubject(line: string): { type: string; scope?: string; breaking: boolean; description: string } | undefined {
  const match = SUBJECT.exec(line.trim());
  if (!match) {
    return undefined;
  }
  return {
    type: match[1],
    scope: match[2],
    breaking: match[3] === '!',
    description: match[4].trim(),
  };
}
