export interface ConsentRoute {
  readonly providerId: string;
  readonly modelId: string;
}

export interface EgressConsent {
  readonly v: 1;
  /** Normalized origin, e.g. "https://api.deepseek.com". */
  readonly origin: string;
  readonly providerId: string;
  /** OpenCode only: the provider/model OpenCode forwards to. */
  readonly routedVia?: ConsentRoute;
  readonly grantedAt: number;
  readonly revokedAt?: number;
}

export interface ConsentRequest {
  readonly origin: string;
  readonly providerId: string;
  readonly model: string;
  readonly mode: string;
  readonly estimatedTokens: number;
  readonly routedVia?: ConsentRoute;
}

export function consentKey(request: ConsentRequest): string {
  const route = request.routedVia ? `${request.routedVia.providerId}/${request.routedVia.modelId}` : '';
  return `${request.origin}|${request.providerId}|${route}`;
}

export function consentMatches(consent: EgressConsent, request: ConsentRequest): boolean {
  if (consent.revokedAt !== undefined) {
    return false;
  }
  if (consent.origin !== request.origin || consent.providerId !== request.providerId) {
    return false;
  }
  const consentRoute = consent.routedVia ? `${consent.routedVia.providerId}/${consent.routedVia.modelId}` : '';
  const requestRoute = request.routedVia ? `${request.routedVia.providerId}/${request.routedVia.modelId}` : '';
  return consentRoute === requestRoute;
}
