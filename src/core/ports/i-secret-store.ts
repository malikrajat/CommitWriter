import type { AppError } from '../domain/errors.js';
import type { Result } from '../domain/result.js';
import type { SecretDescriptor, SecretKind } from '../domain/secret-record.js';

/**
 * Credential storage port. Only `providers/auth-resolver.ts` may call
 * `reveal`; every other consumer uses `describe`.
 */
export interface ISecretStore {
  put(profileId: string, kind: SecretKind, plaintext: string): Promise<Result<SecretDescriptor, AppError>>;
  describe(profileId: string, kind: SecretKind): Promise<SecretDescriptor>;
  delete(profileId: string, kind: SecretKind): Promise<void>;
  reveal(profileId: string, kind: SecretKind): Promise<string | undefined>;
}
