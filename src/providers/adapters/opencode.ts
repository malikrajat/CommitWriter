import { appError, type AppError } from '../../core/domain/errors.js';
import type { CancelSignal } from '../../core/domain/cancel-signal.js';
import type { ProviderProfile } from '../../core/domain/provider-profile.js';
import { err, ok, type Result } from '../../core/domain/result.js';
import type { AIProvider, GenerateRequest, GenerateResult, ModelInfo } from '../../core/ports/i-provider.js';
import type { IHttpClient } from '../../core/ports/i-http-client.js';
import { PRODUCT } from '../../core/product.js';
import type { AuthResolver } from '../auth-resolver.js';
import { asArray, asRecord, asString, parseJson } from '../dialect/dialect.js';
import { normalizeProviderError } from '../error-normalizer.js';
import { abortableDelay } from '../dialect-provider.js';
import { backoffMs, shouldRetry } from '../retry-policy.js';

function base(profile: ProviderProfile): string {
  return profile.baseUrl.endsWith('/') ? profile.baseUrl.slice(0, -1) : profile.baseUrl;
}

function splitModel(model: string): { providerID: string; modelID: string } | undefined {
  const index = model.indexOf('/');
  if (index <= 0 || index === model.length - 1) {
    return undefined;
  }
  return { providerID: model.slice(0, index), modelID: model.slice(index + 1) };
}

interface SessionResult {
  readonly sessionId?: string;
  readonly error?: AppError;
}

/**
 * OpenCode adapter (verified against the documented V1 HTTP server API):
 * /global/health, /config/providers, /session, /session/:id/message,
 * /session/:id/abort, DELETE /session/:id.
 */
export class OpenCodeProvider implements AIProvider {
  readonly id = 'opencode' as const;
  readonly supportsModelListing = true;

  constructor(
    private readonly http: IHttpClient,
    private readonly auth: AuthResolver,
  ) {}

  async generate(profile: ProviderProfile, request: GenerateRequest): Promise<Result<GenerateResult, AppError>> {
    const model = splitModel(profile.model);
    if (!model) {
      return err(
        appError('profile_invalid', 'OpenCode model must be written as "providerID/modelID".', {
          providerId: 'opencode',
        }),
      );
    }

    const auth = await this.auth.resolve(profile);
    if (!auth.ok) {
      return err(auth.error);
    }
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      ...auth.value,
    };
    const root = base(profile);

    const session = await this.createSession(root, headers, request);
    if (!session.sessionId) {
      return err(session.error ?? appError('invalid_response', 'OpenCode did not return a session id.'));
    }
    const sessionId = session.sessionId;

    try {
      let lastError: AppError = appError('internal', 'OpenCode did not return a result.');

      for (let attempt = 0; attempt <= request.maxRetries; attempt += 1) {
        if (request.signal.aborted) {
          return err(appError('cancelled', 'Generation cancelled.'));
        }

        const response = await this.http.send({
          url: `${root}/session/${encodeURIComponent(sessionId)}/message`,
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: { providerID: model.providerID, modelID: model.modelID },
            system: request.system,
            parts: [{ type: 'text', text: request.user }],
          }),
          timeoutMs: request.timeoutMs,
          signal: request.signal,
        });

        if (!response.ok) {
          lastError = response.error;
          if (lastError.code === 'cancelled') {
            return err(lastError);
          }
        } else if (response.value.status >= 200 && response.value.status < 300) {
          const parsed = this.parseMessage(response.value.text);
          if (parsed.ok) {
            return parsed;
          }
          lastError = parsed.error;
        } else {
          lastError = normalizeProviderError({
            status: response.value.status,
            detail: response.value.text,
            providerId: 'opencode',
            model: profile.model,
          });
        }

        if (!shouldRetry(lastError, attempt, request.maxRetries)) {
          return err(lastError);
        }
        await abortableDelay(backoffMs(attempt), request.signal);
      }

      return err(lastError);
    } finally {
      if (request.signal.aborted) {
        await this.abortSession(root, headers, sessionId);
      }
      await this.deleteSession(root, headers, sessionId);
    }
  }

  async listModels(profile: ProviderProfile, signal: CancelSignal): Promise<Result<ModelInfo[], AppError>> {
    const auth = await this.auth.resolve(profile);
    if (!auth.ok) {
      return err(auth.error);
    }
    const response = await this.http.send({
      url: `${base(profile)}/config/providers`,
      method: 'GET',
      headers: { accept: 'application/json', ...auth.value },
      body: undefined,
      timeoutMs: 10000,
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
          providerId: 'opencode',
        }),
      );
    }

    const payload = asRecord(parseJson(response.value.text));
    const providers = asArray(payload?.['providers']);
    const models: ModelInfo[] = [];

    for (const entry of providers) {
      const record = asRecord(entry);
      const providerId = asString(record?.['id']);
      if (!providerId) {
        continue;
      }
      const rawModels = record?.['models'];
      const ids = Array.isArray(rawModels)
        ? rawModels.map((item) => asString(asRecord(item)?.['id']) ?? asString(item))
        : Object.keys(asRecord(rawModels) ?? {});
      for (const id of ids) {
        if (id) {
          models.push({ id: `${providerId}/${id}`, label: `${providerId}/${id}` });
        }
      }
    }

    return ok(models);
  }

  private async createSession(
    root: string,
    headers: Readonly<Record<string, string>>,
    request: GenerateRequest,
  ): Promise<SessionResult> {
    const response = await this.http.send({
      url: `${root}/session`,
      method: 'POST',
      headers,
      body: JSON.stringify({ title: `${PRODUCT.displayName} commit message` }),
      timeoutMs: Math.min(request.timeoutMs, 15000),
      signal: request.signal,
    });
    if (!response.ok) {
      return { error: response.error };
    }
    if (response.value.status < 200 || response.value.status >= 300) {
      return {
        error: normalizeProviderError({
          status: response.value.status,
          detail: response.value.text,
          providerId: 'opencode',
        }),
      };
    }
    const payload = asRecord(parseJson(response.value.text));
    const sessionId = asString(payload?.['id']) ?? asString(asRecord(payload?.['session'])?.['id']);
    if (!sessionId) {
      return { error: appError('invalid_response', 'OpenCode did not return a session id.') };
    }
    return { sessionId };
  }

  private parseMessage(text: string): Result<GenerateResult, AppError> {
    const payload = asRecord(parseJson(text));
    if (!payload) {
      return err(appError('invalid_response', 'OpenCode returned a response that is not valid JSON.'));
    }
    const output = asArray(payload['parts'])
      .map((part) => asRecord(part))
      .filter((part): part is Record<string, unknown> => part !== undefined)
      .map((part) => asString(part['text']) ?? '')
      .join('')
      .trim();

    if (output.length === 0) {
      return err(appError('invalid_response', 'OpenCode returned an empty completion.'));
    }

    return ok({ text: output, finishReason: 'stop' });
  }

  private async abortSession(root: string, headers: Readonly<Record<string, string>>, sessionId: string): Promise<void> {
    await this.http
      .send({
        url: `${root}/session/${encodeURIComponent(sessionId)}/abort`,
        method: 'POST',
        headers,
        body: '{}',
        timeoutMs: 3000,
        signal: { aborted: false, onAbort: () => ({ dispose: () => undefined }) },
      })
      .catch(() => undefined);
  }

  private async deleteSession(root: string, headers: Readonly<Record<string, string>>, sessionId: string): Promise<void> {
    await this.http
      .send({
        url: `${root}/session/${encodeURIComponent(sessionId)}`,
        method: 'DELETE',
        headers,
        body: undefined,
        timeoutMs: 3000,
        signal: { aborted: false, onAbort: () => ({ dispose: () => undefined }) },
      })
      .catch(() => undefined);
  }
}
