import type { ConsentRequest, EgressConsent } from '../domain/consent.js';

export interface IConsentService {
  isGranted(request: ConsentRequest): Promise<boolean>;
  record(request: ConsentRequest): Promise<void>;
  revokeAll(): Promise<void>;
  list(): Promise<readonly EgressConsent[]>;
}
