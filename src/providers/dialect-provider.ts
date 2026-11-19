import { appError, type AppError } from '../core/domain/errors.js';
import type { CancelSignal } from '../core/domain/cancel-signal.js';
import type { ProviderId, ProviderProfile } from '../core/domain/provider-profile.js';
import { err, type Result } from '../core/domain/result.js';
import type { AIProvider, GenerateRequest, GenerateResult, ModelInfo } from '../core/ports/i-provider.js';
import type { IHttpClient } from '../core/ports/i-http-client.js';
import type { AuthResolver } from './auth-resolver.js';
import type { Dialect, DialectContext } from './dialect/dialect.js';
import { normalizeProviderError } from './error-normalizer.js';
import { backoffMs, parseRetryAfterMs, shouldRetry } from './retry-policy.js';

export function abortableDelay(ms: number, signal: CancelSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve();
      return;
    }
    let subscription: { dispose(): void } | undefined;
    const timer = setTimeout(() => {
      subscription?.dispose();
      resolve();
    }, ms);
    subscription = signal.onAbort(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function cancelled(): AppError {
  return appError('cancelled', 'Generation cancelled.');
}

/** Shared implementation for every wire-dialect provider. */
export class DialectProvider implements AIProvider {
  constructor(
    readonly id: ProviderId,
    private readonly dialect: Dialect,
    private readonly http: IHttpClient,
    private readonly auth: AuthResolver,
    readonly supportsModelListing: boolean,
  ) {}

  async generate(profile: ProviderProfile, request: GenerateRequest): Promise<Result<GenerateResult, AppError>> {
    const auth = await this.auth.resolve(profile);
    if (!auth.ok) {
      return err(auth.error);
    }
    const context: DialectContext = { profile, authHeaders: auth.value };

    let lastError: AppError = appError('internal', 'The provider did not return a result.');

    for (let attempt = 0; attempt <= request.maxRetries; attempt += 1) {
      if (request.signal.aborted) {
        return err(cancelled());
      }

      const built = this.dialect.buildGenerate(context, { ...request, model: profile.model });
      const response = await this.http.send({
        url: built.url,
        method: 'POST',
        headers: built.headers,
        body: built.body,
        timeoutMs: request.timeoutMs,
        signal: request.signal,
      });

      let retryAfterMs: number | undefined;

      if (!response.ok) {
        lastError = response.error;
        if (lastError.code === 'cancelled') {
          return err(lastError);
        }
      } else if (response.value.status >= 200 && response.value.status < 300) {
        const parsed = this.dialect.parseGenerate(response.value.status, response.value.text);
        if (parsed.ok) {
          return parsed;
        }
        lastError = parsed.error;
      } else {
        lastError = normalizeProviderError({
          status: response.value.status,
          detail: response.value.text,
          providerId: this.id,
          model: profile.model,
        });
        retryAfterMs = parseRetryAfterMs(response.value.headers);
      }

      if (!shouldRetry(lastError, attempt, request.maxRetries)) {
        return err(lastError);
      }
      await abortableDelay(backoffMs(attempt, retryAfterMs), request.signal);
    }

    return err(lastError);
  }

  async listModels(profile: ProviderProfile, signal: CancelSignal): Promise<Result<ModelInfo[], AppError>> {
    const auth = await this.auth.resolve(profile);
    if (!auth.ok) {
      return err(auth.error);
    }
    const context: DialectContext = { profile, authHeaders: auth.value };
    const built = this.dialect.buildModels(context);
    if (!built) {
      return err(appError('bad_request', 'This provider does not expose a model list.'));
    }

    const response = await this.http.send({
      url: built.url,
      method: 'GET',
      headers: built.headers,
      body: undefined,
      timeoutMs: 15000,
      signal,
    });
    if (!response.ok) {
      return err(response.error);
    }
    if (response.value.status < 200 || response.value.status >= 300) {
      return err(
        normalizeProviderError({
          status: response.value.status,
          detail: response.value.text,
          providerId: this.id,
        }),
      );
    }
    return this.dialect.parseModels(response.value.status, response.value.text);
  }
}
