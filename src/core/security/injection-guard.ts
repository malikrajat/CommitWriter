export const UNTRUSTED_OPEN = '<untrusted_diff';
export const UNTRUSTED_CLOSE = '</untrusted_diff>';

/**
 * Wraps diff content so the model can be told, unambiguously, that everything
 * inside is data. Content can never terminate the wrapper early.
 */
export function wrapUntrustedDiff(path: string, lines: readonly string[]): string {
  const safePath = path.replace(/["<>\r\n]/g, '_');
  const body = lines.map((line) => line.replace(/<\/?untrusted_diff/gi, '[diff-tag]')).join('\n');
  return `<untrusted_diff path="${safePath}">\n${body}\n</untrusted_diff>`;
}

const SIGNALS: readonly RegExp[] = [
  /ignore (all )?(previous|prior|above) instructions/i,
  /disregard (the )?(system|previous) prompt/i,
  /you are now/i,
  /new instructions:/i,
  /system message:/i,
  /reveal (your|the) (system )?prompt/i,
];

/** Detection only; never alters the payload. Used for user-visible warnings. */
export function detectInjectionSignals(text: string): readonly string[] {
  const hits: string[] = [];
  for (const signal of SIGNALS) {
    if (signal.test(text)) {
      hits.push(signal.source);
    }
  }
  return hits;
}
