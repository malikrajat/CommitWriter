import type * as vscode from 'vscode';
import { appError, type AppError } from '../core/domain/errors.js';
import { ok, type Result } from '../core/domain/result.js';
import type { SecretDescriptor, SecretKind, SecretRecord } from '../core/domain/secret-record.js';
import { secretStorageKey } from '../core/domain/secret-record.js';
import type { IClock } from '../core/ports/i-clock.js';
import type { ISecretStore } from '../core/ports/i-secret-store.js';

function lastFour(value: string): string {
  return value.length <= 4 ? '****' : `****${value.slice(-4)}`;
}

/**
 * SecretStorage-backed credential store. Plaintext never leaves this class
 * except through `reveal`, which is called only by the auth resolver.
 */
export class SecretStore implements ISecretStore {
  constructor(
    private readonly storage: vscode.SecretStorage,
    private readonly clock: IClock,
  ) {}

  async put(profileId: string, kind: SecretKind, plaintext: string): Promise<Result<SecretDescriptor, AppError>> {
    const value = plaintext.trim();
    if (value.length === 0) {
      return { ok: false, error: appError('config', 'Secret must not be empty.') };
    }
    const record: SecretRecord = {
      v: 1,
      kind,
      value,
      createdAt: this.clock.now(),
      lastFour: lastFour(value),
    };
    await this.storage.store(secretStorageKey(profileId, kind), JSON.stringify(record));
    return ok({
      profileId,
      kind,
      present: true,
      lastFour: record.lastFour,
      updatedAt: record.createdAt,
    });
  }

  async describe(profileId: string, kind: SecretKind): Promise<SecretDescriptor> {
    const record = await this.read(profileId, kind);
    if (!record) {
      return { profileId, kind, present: false };
    }
    return {
      profileId,
      kind,
      present: true,
      lastFour: record.lastFour,
      updatedAt: record.createdAt,
    };
  }

  async delete(profileId: string, kind: SecretKind): Promise<void> {
    await this.storage.delete(secretStorageKey(profileId, kind));
  }

  async reveal(profileId: string, kind: SecretKind): Promise<string | undefined> {
    const record = await this.read(profileId, kind);
    return record?.value;
  }

  private async read(profileId: string, kind: SecretKind): Promise<SecretRecord | undefined> {
    const raw = await this.storage.get(secretStorageKey(profileId, kind));
    if (!raw) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw) as SecretRecord;
      return parsed && parsed.v === 1 && typeof parsed.value === 'string' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
}
