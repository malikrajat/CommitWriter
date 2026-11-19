const CHARS_PER_TOKEN = 3.6;
const MESSAGE_OVERHEAD = 4;

/**
 * Provider-agnostic estimate. Deliberately conservative (chars/3.6 rather
 * than chars/4) plus fixed per-message overhead.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN) + MESSAGE_OVERHEAD;
}

export function estimateLines(lines: readonly string[]): number {
  return estimateTokens(lines.join('\n'));
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return String(tokens);
}
