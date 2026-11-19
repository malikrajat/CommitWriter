export type ProviderId =
  | 'deepseek'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'ollama'
  | 'lmstudio'
  | 'llamacpp'
  | 'vllm'
  | 'opencode'
  | 'custom';

export type WireDialect =
  | 'openai-chat'
  | 'anthropic-messages'
  | 'gemini-generate'
  | 'ollama-native'
  | 'opencode-session';

export type ProfileAuthStyle = 'bearer' | 'api-key-header' | 'none';

export type ProfileId = string;

export const PROVIDER_IDS: readonly ProviderId[] = [
  'deepseek',
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
  'ollama',
  'lmstudio',
  'llamacpp',
  'vllm',
  'opencode',
  'custom',
];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);
}

export interface ProviderProfile {
  readonly id: ProfileId;
  readonly label: string;
  readonly provider: ProviderId;
  readonly dialect: WireDialect;
  readonly baseUrl: string;
  readonly model: string;
  readonly fallbackModel?: string;
  readonly contextWindow: number;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** Overrides the preset auth strategy (custom endpoints). */
  readonly authStyle?: ProfileAuthStyle;
  /** Header used when `authStyle` is `api-key-header`. */
  readonly authHeaderName?: string;
}

export const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}$/;

/** Header names that may never be supplied through profile configuration. */
const FORBIDDEN_HEADERS = ['authorization', 'x-api-key', 'x-goog-api-key', 'proxy-authorization', 'cookie'];

/** Header names that cannot be used as a custom credential header. */
const RESERVED_AUTH_HEADERS = [
  'authorization',
  'cookie',
  'host',
  'content-length',
  'content-type',
  'accept',
  'connection',
];

const HEADER_NAME = /^[A-Za-z0-9-]+$/;

export function isForbiddenHeader(name: string): boolean {
  return FORBIDDEN_HEADERS.includes(name.toLowerCase());
}

export function isReservedAuthHeader(name: string): boolean {
  return RESERVED_AUTH_HEADERS.includes(name.toLowerCase());
}

export interface ProfileValidation {
  readonly valid: boolean;
  readonly problems: readonly string[];
}

export function validateProfile(profile: ProviderProfile): ProfileValidation {
  const problems: string[] = [];
  if (!PROFILE_ID_PATTERN.test(profile.id)) {
    problems.push('profile id must match ^[a-z0-9][a-z0-9-]{1,30}$');
  }
  if (profile.label.trim().length === 0) {
    problems.push('profile label must not be empty');
  }
  if (profile.model.trim().length === 0) {
    problems.push('model must not be empty');
  }
  if (profile.baseUrl.trim().length === 0) {
    problems.push('base URL must not be empty');
  }
  if (!Number.isFinite(profile.contextWindow) || profile.contextWindow < 1024) {
    problems.push('contextWindow must be at least 1024');
  }
  if (
    profile.timeoutMs !== undefined &&
    (!Number.isInteger(profile.timeoutMs) || profile.timeoutMs < 5000 || profile.timeoutMs > 300000)
  ) {
    problems.push('timeoutMs must be an integer between 5000 and 300000');
  }
  for (const header of Object.keys(profile.headers ?? {})) {
    if (isForbiddenHeader(header)) {
      problems.push(`header "${header}" is reserved for credentials and cannot be configured`);
    }
  }
  if (profile.authStyle === 'api-key-header') {
    const name = profile.authHeaderName ?? 'x-api-key';
    if (!HEADER_NAME.test(name)) {
      problems.push('authHeaderName must be a valid HTTP header name');
    } else if (isReservedAuthHeader(name)) {
      problems.push(`header "${name}" cannot carry credentials`);
    }
  }
  return { valid: problems.length === 0, problems };
}
