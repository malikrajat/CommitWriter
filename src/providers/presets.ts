import type { ProviderId, WireDialect } from '../core/domain/provider-profile.js';

export type AuthStyle = 'bearer' | 'anthropic' | 'gemini' | 'basic' | 'none';

export interface ProviderPreset {
  readonly id: ProviderId;
  readonly label: string;
  readonly dialect: WireDialect;
  readonly baseUrl: string;
  readonly auth: AuthStyle;
  readonly supportsModelListing: boolean;
  readonly defaultContextWindow: number;
  readonly modelHint: string;
}

export const PROVIDER_PRESETS: Readonly<Record<ProviderId, ProviderPreset>> = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    dialect: 'openai-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    auth: 'bearer',
    supportsModelListing: true,
    defaultContextWindow: 64000,
    modelHint: 'deepseek-chat',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    dialect: 'openai-chat',
    baseUrl: 'https://api.openai.com/v1',
    auth: 'bearer',
    supportsModelListing: true,
    defaultContextWindow: 128000,
    modelHint: 'gpt-4o-mini',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    dialect: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    auth: 'anthropic',
    supportsModelListing: true,
    defaultContextWindow: 200000,
    modelHint: 'claude-3-5-sonnet-latest',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    dialect: 'gemini-generate',
    baseUrl: 'https://generativelanguage.googleapis.com',
    auth: 'gemini',
    supportsModelListing: true,
    defaultContextWindow: 1000000,
    modelHint: 'gemini-1.5-flash',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    dialect: 'openai-chat',
    baseUrl: 'https://openrouter.ai/api/v1',
    auth: 'bearer',
    supportsModelListing: true,
    defaultContextWindow: 128000,
    modelHint: 'openai/gpt-4o-mini',
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    dialect: 'ollama-native',
    baseUrl: 'http://127.0.0.1:11434',
    auth: 'none',
    supportsModelListing: true,
    defaultContextWindow: 8192,
    modelHint: 'qwen2.5-coder:7b',
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    dialect: 'openai-chat',
    baseUrl: 'http://127.0.0.1:1234/v1',
    auth: 'none',
    supportsModelListing: true,
    defaultContextWindow: 8192,
    modelHint: 'local-model',
  },
  llamacpp: {
    id: 'llamacpp',
    label: 'llama.cpp server (local)',
    dialect: 'openai-chat',
    baseUrl: 'http://127.0.0.1:8080/v1',
    auth: 'none',
    supportsModelListing: true,
    defaultContextWindow: 8192,
    modelHint: 'local-model',
  },
  vllm: {
    id: 'vllm',
    label: 'vLLM (local)',
    dialect: 'openai-chat',
    baseUrl: 'http://127.0.0.1:8000/v1',
    auth: 'none',
    supportsModelListing: true,
    defaultContextWindow: 8192,
    modelHint: 'local-model',
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode (local server)',
    dialect: 'opencode-session',
    baseUrl: 'http://127.0.0.1:4096',
    auth: 'basic',
    supportsModelListing: true,
    defaultContextWindow: 128000,
    modelHint: 'anthropic/claude-sonnet-4',
  },
  custom: {
    id: 'custom',
    label: 'Custom OpenAI-compatible endpoint',
    dialect: 'openai-chat',
    baseUrl: '',
    auth: 'bearer',
    supportsModelListing: true,
    defaultContextWindow: 128000,
    modelHint: 'gpt-4o-mini',
  },
};

export function presetFor(providerId: ProviderId): ProviderPreset {
  return PROVIDER_PRESETS[providerId];
}
