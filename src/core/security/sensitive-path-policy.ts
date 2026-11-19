import type { Sensitivity } from '../domain/diff-hunk.js';

interface SensitiveRule {
  readonly pattern: RegExp;
  readonly sensitivity: Exclude<Sensitivity, 'none'>;
  readonly label: string;
}

const RULES: readonly SensitiveRule[] = [
  { pattern: /(^|\/)\.env(\.|$)/i, sensitivity: 'blocked', label: 'environment file' },
  { pattern: /(^|\/)\.envrc$/i, sensitivity: 'blocked', label: 'direnv environment file' },
  { pattern: /\.(pem|key|p12|pfx|keystore|jks|asc|gpg|kdbx)$/i, sensitivity: 'blocked', label: 'key material' },
  { pattern: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.|$)/i, sensitivity: 'blocked', label: 'ssh private key' },
  { pattern: /(^|\/)\.npmrc$/i, sensitivity: 'blocked', label: 'npm credentials' },
  { pattern: /(^|\/)\.pypirc$/i, sensitivity: 'blocked', label: 'pypi credentials' },
  { pattern: /(^|\/)\.netrc$/i, sensitivity: 'blocked', label: 'netrc credentials' },
  { pattern: /(^|\/)\.git-credentials$/i, sensitivity: 'blocked', label: 'git credentials' },
  { pattern: /(^|\/)\.ssh\//i, sensitivity: 'blocked', label: 'ssh directory' },
  { pattern: /(^|\/)\.aws\//i, sensitivity: 'blocked', label: 'aws directory' },
  { pattern: /(^|\/)\.azure\//i, sensitivity: 'blocked', label: 'azure directory' },
  { pattern: /(^|\/)\.docker\/config\.json$/i, sensitivity: 'blocked', label: 'docker credentials' },
  { pattern: /(^|\/)secrets?\//i, sensitivity: 'blocked', label: 'secrets directory' },
  { pattern: /(^|\/)credentials?(\.|$)/i, sensitivity: 'blocked', label: 'credentials file' },
  { pattern: /service[-_]?account[^/]*\.json$/i, sensitivity: 'blocked', label: 'service account key' },
  { pattern: /(^|\/)kubeconfig$/i, sensitivity: 'suspicious', label: 'kubeconfig' },
  { pattern: /\.tfvars$/i, sensitivity: 'suspicious', label: 'terraform variables' },
  { pattern: /(^|\/)config\/(secrets?|credentials?)[^/]*$/i, sensitivity: 'suspicious', label: 'config secrets' },
  { pattern: /(^|\/)\.pulumi\//i, sensitivity: 'suspicious', label: 'pulumi state' },
];

export interface SensitivityVerdict {
  readonly sensitivity: Sensitivity;
  readonly label?: string;
}

export function classifyPath(path: string): SensitivityVerdict {
  for (const rule of RULES) {
    if (rule.pattern.test(path)) {
      return { sensitivity: rule.sensitivity, label: rule.label };
    }
  }
  return { sensitivity: 'none' };
}

export function isBlocked(path: string): boolean {
  return classifyPath(path).sensitivity === 'blocked';
}
