import type { ParsedMessage } from './output-parser.js';

export interface RepairResult {
  readonly message: ParsedMessage;
  readonly repairs: readonly string[];
}

const VERBOSE_PREFIX = /^(here(?:'s| is)[^:]*:\s*)/i;

/**
 * Mechanical fixes only: never invents content, only removes common model
 * decoration (preamble, code fences, quotes, trailing periods).
 */
export function repairMessage(parsed: ParsedMessage): RepairResult {
  const repairs: string[] = [];
  let subject = parsed.subject.trim();

  const prefix = VERBOSE_PREFIX.exec(subject);
  if (prefix) {
    subject = subject.slice(prefix[0].length).trim();
    repairs.push('removed preamble');
  }

  const hadFence = subject.startsWith('```') || subject.endsWith('```');
  subject = subject.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
  if (hadFence) {
    repairs.push('removed code fence');
  }

  const unquoted = subject.replace(/^["'`]+|["'`]+$/g, '').trim();
  if (unquoted !== subject) {
    subject = unquoted;
    repairs.push('removed surrounding quotes');
  }

  if (/[.!]$/.test(subject) && !subject.endsWith('...')) {
    subject = subject.replace(/[.!]+$/, '');
    repairs.push('removed trailing punctuation');
  }

  const body = parsed.body
    ?.split('\n')
    .filter((line) => !line.trim().startsWith('```'))
    .join('\n')
    .trim();

  return {
    message: {
      subject,
      body: body && body.length > 0 ? body : undefined,
      footers: parsed.footers,
    },
    repairs,
  };
}
