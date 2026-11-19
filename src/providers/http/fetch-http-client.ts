import { appError, type AppError } from '../../core/domain/errors.js';
import { err } from '../../core/domain/result.js';
import type { Result } from '../../core/domain/result.js';
import type { IHttpClient, HttpRequest, HttpResponse } from '../../core/ports/i-http-client.js';

function toHeaders(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key.toLowerCase()] = value;
  });
  return output;
}

/**
 * The only `fetch` call site in the extension. Timeout and cancellation are
 * wired here so no adapter can forget them.
 */
export class FetchHttpClient implements IHttpClient {
  async send(request: HttpRequest): Promise<Result<HttpResponse, AppError>> {
    if (request.signal.aborted) {
      return err(appError('cancelled', 'Generation cancelled.'));
    }

    const controller = new AbortController();
    let timedOut = false;
    const subscription = request.signal.onAbort(() => controller.abort());
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, request.timeoutMs);

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers as Record<string, string>,
        body: request.body && request.body.length > 0 ? request.body : undefined,
        signal: controller.signal,
        // Redirects are not followed: a provider could redirect to a host that
        // violates the egress policy (including plain http).
        redirect: 'manual',
      });
      if (response.status >= 300 && response.status < 400) {
        return err(
          appError('bad_request', 'The endpoint redirected the request; redirects are not followed.', {
            httpStatus: response.status,
          }),
        );
      }
      const text = await response.text();
      return {
        ok: true,
        value: { status: response.status, headers: toHeaders(response.headers), text },
      };
    } catch (error) {
      if (request.signal.aborted) {
        return err(appError('cancelled', 'Generation cancelled.'));
      }
      if (timedOut) {
        return err(appError('timeout', 'The provider did not respond before the timeout.', { retryable: true }));
      }
      const message = error instanceof Error ? error.message : '';
      if (/certificate|tls|ssl/i.test(message)) {
        return err(appError('tls', 'TLS negotiation with the provider failed.'));
      }
      return err(appError('network', 'Could not reach the provider endpoint.', { retryable: true }));
    } finally {
      clearTimeout(timer);
      subscription.dispose();
    }
  }
}
