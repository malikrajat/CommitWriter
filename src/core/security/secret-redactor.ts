export interface RedactionResult {
  readonly text: string;
  readonly redactions: number;
}

interface Rule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly replacement: string;
}

const RULES: readonly Rule[] = [
  {
    name: 'private-key',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED:private-key]',
  },
  {
    name: 'aws-access-key',
    pattern: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED:aws-key]',
  },
  {
    name: 'github-token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g,
    replacement: '[REDACTED:github-token]',
  },
  {
    name: 'openai-style-key',
    pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g,
    replacement: '[REDACTED:api-key]',
  },
  {
    name: 'slack-token',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
    replacement: '[REDACTED:slack-token]',
  },
  {
    name: 'google-api-key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replacement: '[REDACTED:google-key]',
  },
  {
    name: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: '[REDACTED:jwt]',
  },
  {
    name: 'bearer',
    pattern: /(\bBearer\s+)[A-Za-z0-9\-._~+/]{16,}=*/gi,
    replacement: '$1[REDACTED:token]',
  },
  {
    name: 'assignment',
    pattern:
      /((?:["']?(?:api[_-]?key|secret[_-]?access[_-]?key|access[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password|passwd|pwd)["']?)\s*[:=]\s*['"]?)[^\s'",;]{4,}/gi,
    replacement: '$1[REDACTED:secret]',
  },
  {
    name: 'connection-string',
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]{3,})(@)/gi,
    replacement: '$1[REDACTED]@',
  },
];

const HIGH_ENTROPY = /\b[A-Za-z0-9+/_=-]{40,}={0,2}\b/g;

function isMixedSecret(token: string): boolean {
  if (/^[0-9a-fA-F]+$/.test(token)) {
    return false; // git SHAs, hex digests
  }
  if (/^[A-Za-z]+$/.test(token) || /^[0-9]+$/.test(token)) {
    return false;
  }
  const hasUpper = /[A-Z]/.test(token);
  const hasLower = /[a-z]/.test(token);
  const hasDigit = /[0-9]/.test(token);
  const uniqueRatio = new Set(token).size / token.length;
  return hasUpper && hasLower && hasDigit && uniqueRatio > 0.4;
}

/**
 * Removes credential-shaped content from any text that is about to leave the
 * process (request body) or be persisted (logs). Conservative by design:
 * over-redaction is acceptable, under-redaction is not.
 */
export function redactSecrets(input: string): RedactionResult {
  let text = input;
  let redactions = 0;

  for (const rule of RULES) {
    const matches = text.match(rule.pattern);
    if (!matches || matches.length === 0) {
      continue;
    }
    redactions += matches.length;
    text = text.replace(rule.pattern, rule.replacement);
  }

  text = text.replace(HIGH_ENTROPY, (token) => {
    if (!isMixedSecret(token)) {
      return token;
    }
    redactions += 1;
    return '[REDACTED:high-entropy]';
  });

  return { text, redactions };
}

export function containsSecretShape(input: string): boolean {
  return redactSecrets(input).redactions > 0;
}
