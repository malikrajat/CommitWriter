import type * as vscode from 'vscode';
import { consentMatches, type ConsentRequest, type EgressConsent } from '../core/domain/consent.js';
import type { IConsentService } from '../core/ports/i-consent-service.js';

import { PRODUCT } from '../core/product.js';

const KEY = `${PRODUCT.storagePrefix}.consent.v1`;

export class ConsentService implements IConsentService {
  constructor(
    private readonly state: vscode.Memento,
    private readonly clock: { now(): number },
  ) {}

  async isGranted(request: ConsentRequest): Promise<boolean> {
    const grants = this.state.get<EgressConsent[]>(KEY, []) ?? [];
    return grants.some((grant) => consentMatches(grant, request));
  }

  async record(request: ConsentRequest): Promise<void> {
    const grants = (this.state.get<EgressConsent[]>(KEY, []) ?? []).filter(
      (grant) => !consentMatches(grant, request),
    );
    const route = request.routedVia
      ? { providerId: request.routedVia.providerId, modelId: request.routedVia.modelId }
      : undefined;
    grants.push({
      v: 1,
      origin: request.origin,
      providerId: request.providerId,
      routedVia: route,
      grantedAt: this.clock.now(),
    });
    await this.state.update(KEY, grants);
  }

  async revokeAll(): Promise<void> {
    await this.state.update(KEY, []);
  }

  async list(): Promise<readonly EgressConsent[]> {
    return this.state.get<EgressConsent[]>(KEY, []) ?? [];
  }
}
