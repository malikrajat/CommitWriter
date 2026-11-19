import type { ProviderProfile, WireDialect } from '../core/domain/provider-profile.js';
import type { AIProvider } from '../core/ports/i-provider.js';
import type { IHttpClient } from '../core/ports/i-http-client.js';
import { anthropicMessagesDialect } from './dialect/anthropic-messages.js';
import { geminiGenerateDialect } from './dialect/gemini-generate.js';
import { ollamaNativeDialect } from './dialect/ollama-native.js';
import { openAiChatDialect } from './dialect/openai-chat.js';
import type { Dialect } from './dialect/dialect.js';
import { DialectProvider } from './dialect-provider.js';
import { OpenCodeProvider } from './adapters/opencode.js';
import type { AuthResolver } from './auth-resolver.js';
import { presetFor } from './presets.js';

const DIALECTS: Readonly<Record<Exclude<WireDialect, 'opencode-session'>, Dialect>> = {
  'openai-chat': openAiChatDialect,
  'anthropic-messages': anthropicMessagesDialect,
  'gemini-generate': geminiGenerateDialect,
  'ollama-native': ollamaNativeDialect,
};

export function dialectFor(profile: ProviderProfile): Dialect | undefined {
  if (profile.dialect === 'opencode-session') {
    return undefined;
  }
  return DIALECTS[profile.dialect] ?? DIALECTS['openai-chat'];
}

export class ProviderRegistry {
  private readonly cache = new Map<string, AIProvider>();

  constructor(
    private readonly http: IHttpClient,
    private readonly auth: AuthResolver,
  ) {}

  get(profile: ProviderProfile): AIProvider {
    const key = `${profile.provider}:${profile.dialect}`;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const provider: AIProvider =
      profile.dialect === 'opencode-session'
        ? new OpenCodeProvider(this.http, this.auth)
        : new DialectProvider(
            profile.provider,
            dialectFor(profile) ?? openAiChatDialect,
            this.http,
            this.auth,
            presetFor(profile.provider).supportsModelListing,
          );

    this.cache.set(key, provider);
    return provider;
  }
}
