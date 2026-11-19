import { appError, type AppError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const BLOCKED_HOST_PATTERNS: readonly RegExp[] = [
  /^169\.254\./, // link-local, includes cloud metadata 169.254.169.254
  /^100\.100\.100\.200$/, // alibaba metadata
  /^fd00:ec2::254$/,
  /^0\.0\.0\.0$/,
  /^\[?::\]?$/,
];

export interface AllowedUrl {
  readonly url: URL;
  readonly origin: string;
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host) || host.startsWith('127.');
}

export function originOf(rawUrl: string): string {
  const url = new URL(rawUrl);
  return url.origin;
}

/**
 * Egress URL policy. `https` is mandatory for anything that is not loopback.
 * Credentials in the URL, non-HTTP schemes and metadata endpoints are rejected.
 * There is deliberately no certificate-validation bypass anywhere in the extension.
 */
export interface UrlPolicyOptions {
  /** Reject any non-loopback endpoint (offline / air-gapped mode). */
  readonly localOnly?: boolean;
}

export function evaluateUrl(
  rawUrl: string,
  providerId: string,
  options: UrlPolicyOptions = {},
): Result<AllowedUrl, AppError> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return err(appError('url_rejected', `${providerId}: base URL is not a valid URL.`, { providerId }));
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return err(appError('url_rejected', `${providerId}: only http(s) base URLs are supported.`, { providerId }));
  }
  if (url.username || url.password) {
    return err(
      appError('url_rejected', `${providerId}: base URL must not embed credentials; use the API key command.`, {
        providerId,
      }),
    );
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    return err(
      appError('url_rejected', `${providerId}: plain http is only allowed for localhost/loopback endpoints.`, {
        providerId,
      }),
    );
  }
  if (BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname.toLowerCase()))) {
    return err(appError('url_rejected', `${providerId}: base URL targets a blocked address.`, { providerId }));
  }
  if (options.localOnly === true && !isLoopbackHost(url.hostname)) {
    return err(
      appError(
        'url_rejected',
        `${providerId}: local-only mode is enabled, so only loopback endpoints (Ollama, LM Studio, llama.cpp, vLLM) are allowed.`,
        { providerId },
      ),
    );
  }

  return ok({ url, origin: url.origin });
}

export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}
