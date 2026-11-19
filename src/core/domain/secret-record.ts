import { PRODUCT } from '../product.js';

export type SecretKind = 'apiKey' | 'basicPassword';

export interface SecretRecord {
  readonly v: 1;
  readonly kind: SecretKind;
  readonly value: string;
  readonly createdAt: number;
  readonly lastFour: string;
}

/** The only shape allowed to cross into the UI layer. Never contains plaintext. */
export interface SecretDescriptor {
  readonly profileId: string;
  readonly kind: SecretKind;
  readonly present: boolean;
  readonly lastFour?: string;
  readonly updatedAt?: number;
}

export function secretStorageKey(profileId: string, kind: SecretKind): string {
  return kind === 'apiKey' ? `${PRODUCT.storagePrefix}.apikey.${profileId}` : `${PRODUCT.storagePrefix}.opencode.password.${profileId}`;
}
