import type { AppError } from '../../core/domain/errors.js';
import type { Result } from '../../core/domain/result.js';
import type { HttpRequest, HttpResponse, IHttpClient } from '../../core/ports/i-http-client.js';
import { redactSecrets } from '../../core/security/secret-redactor.js';

/**
 * Redaction interceptor. Request bodies are redacted before serialization to
 * the socket, and failed responses are redacted before any caller can surface
 * them. Successful response bodies are untouched so model output is never
 * corrupted.
 */
export class RedactingHttpClient implements IHttpClient {
  constructor(private readonly inner: IHttpClient) {}

  async send(request: HttpRequest): Promise<Result<HttpResponse, AppError>> {
    const body = request.body === undefined ? undefined : redactSecrets(request.body).text;
    const result = await this.inner.send({ ...request, body });

    if (!result.ok || result.value.status < 400) {
      return result;
    }

    return {
      ok: true,
      value: { ...result.value, text: redactSecrets(result.value.text).text },
    };
  }
}
