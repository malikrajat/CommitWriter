import { appError, type AppError } from '../core/domain/errors.js';
import type { ProviderProfile } from '../core/domain/provider-profile.js';
import { err, ok, type Result } from '../core/domain/result.js';
import type { ISecretStore } from '../core/ports/i-secret-store.js';
import { presetFor } from './presets.js';

/**
 * The ONLY module allowed to call `ISecretStore.reveal`.
 * Credentials are converted straight into request headers and never returned.
 */
export class AuthResolver {
  constructor(private readonly secrets: ISecretStore) {}

  async resolve(profile: ProviderProfile): Promise<Result<Readonly<Record<string, string>>, AppError>> {
    const preset = presetFor(profile.provider);
    const style = profile.authStyle ?? preset.auth;

    if (style === 'none') {
      return ok({});
    }

    if (style === 'basic') {
      const password = await this.secrets.reveal(profile.id, 'basicPassword');
      if (!password) {
        return ok({});
      }
      const encoded = Buffer.from(`opencode:${password}`, 'utf8').toString('base64');
      return ok({ authorization: `Basic ${encoded}` });
    }

    const key = await this.secrets.reveal(profile.id, 'apiKey');
    if (!key) {
      return err(
        appError('secret_missing', `No API key stored for profile "${profile.label}".`, {
          providerId: profile.provider,
        }),
      );
    }

    if (style === 'api-key-header') {
      const headerName = profile.authHeaderName ?? 'x-api-key';
      return ok({ [headerName]: key });
    }

    switch (style) {
      case 'bearer':
        return ok({ authorization: `Bearer ${key}` });
      case 'anthropic':
        return ok({ 'x-api-key': key });
      case 'gemini':
        return ok({ 'x-goog-api-key': key });
      default:
        return err(appError('internal', 'Unsupported authentication style.'));
    }
  }
}
