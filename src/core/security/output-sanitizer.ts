/* eslint-disable no-control-regex -- this module exists to strip control characters */
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const FENCE = /^\s*```.*$/gm;
const GIT_SCISSORS = /^\s*# -{2,} ?>{2,} ?8\s*$/gm;

/** Removes terminal escapes, control characters and markdown fences. */
export function sanitizeText(input: string): string {
  return input
    .replace(ANSI, '')
    .replace(CONTROL, '')
    .replace(/\r\n?/g, '\n')
    .replace(FENCE, '')
    .replace(GIT_SCISSORS, '');
}

/** Normalizes a message body: trimmed lines, no more than one blank line in a row. */
export function sanitizeCommitText(input: string): string {
  const lines = sanitizeText(input)
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''));

  const output: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) {
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
      }
      continue;
    }
    output.push(line);
  }
  while (output.length > 0 && output[output.length - 1] === '') {
    output.pop();
  }
  return output.join('\n');
}
