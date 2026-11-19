import type { AppError } from '../../core/domain/errors.js';
import type { ProviderProfile, WireDialect } from '../../core/domain/provider-profile.js';
import type { Result } from '../../core/domain/result.js';
import type { GenerateRequest, GenerateResult, ModelInfo } from '../../core/ports/i-provider.js';

export interface DialectRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface DialectContext {
  readonly profile: ProviderProfile;
  readonly authHeaders: Readonly<Record<string, string>>;
}

export interface Dialect {
  readonly id: WireDialect;
  buildGenerate(context: DialectContext, request: GenerateRequest): DialectRequest;
  parseGenerate(status: number, text: string): Result<GenerateResult, AppError>;
  buildModels(context: DialectContext): DialectRequest | undefined;
  parseModels(status: number, text: string): Result<ModelInfo[], AppError>;
}

export function withTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

export function jsonHeaders(authHeaders: Readonly<Record<string, string>>): Record<string, string> {
  return { 'content-type': 'application/json', accept: 'application/json', ...authHeaders };
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
