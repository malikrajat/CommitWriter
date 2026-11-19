import { appError, type AppError } from '../core/domain/errors.js';
import type { ProviderProfile } from '../core/domain/provider-profile.js';
import type { Result } from '../core/domain/result.js';
import { err, ok } from '../core/domain/result.js';
import { presetFor } from './presets.js';
import { evaluateUrl } from '../core/security/url-policy.js';

/**
 * Normalizes a configured profile into an effective one: fills preset defaults,
 * derives the dialect for non-custom providers, and applies the URL policy
 * before any network activity.
 */
export function resolveEffectiveProfile(
  profile: ProviderProfile,
  options: { readonly localOnly?: boolean } = {},
): Result<ProviderProfile, AppError> {
  const preset = presetFor(profile.provider);
  const baseUrl = profile.baseUrl.trim().length > 0 ? profile.baseUrl.trim() : preset.baseUrl;

  if (baseUrl.length === 0) {
    return err(appError('profile_invalid', 'Profile has no base URL.', { providerId: profile.provider }));
  }

  const urlCheck = evaluateUrl(baseUrl, profile.provider, { localOnly: options.localOnly });
  if (!urlCheck.ok) {
    return urlCheck;
  }

  const dialect = profile.dialect;
  return ok({
    ...profile,
    baseUrl,
    dialect,
    contextWindow: profile.contextWindow > 0 ? profile.contextWindow : preset.defaultContextWindow,
  });
}
