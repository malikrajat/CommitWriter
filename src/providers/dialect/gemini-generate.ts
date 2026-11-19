import { appError, type AppError } from '../../core/domain/errors.js';
import type { Result } from '../../core/domain/result.js';
import { err, ok } from '../../core/domain/result.js';
import type { GenerateRequest, GenerateResult, ModelInfo } from '../../core/ports/i-provider.js';
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  jsonHeaders,
  parseJson,
  withTrailingSlash,
  type Dialect,
  type DialectContext,
  type DialectRequest,
} from './dialect.js';

/**
 * Gemini API key is sent as a header, never as a query parameter, so it can
 * never leak through URL logging.
 */
export const geminiGenerateDialect: Dialect = {
  id: 'gemini-generate',

  buildGenerate(context: DialectContext, request: GenerateRequest): DialectRequest {
    const base = withTrailingSlash(context.profile.baseUrl);
    const model = encodeURIComponent(request.model.replace(/^models\//, ''));
    return {
      url: `${base}v1beta/models/${model}:generateContent`,
      headers: {
        ...jsonHeaders(context.authHeaders),
        ...(context.profile.headers ?? {}),
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: 'user', parts: [{ text: request.user }] }],
        generationConfig: {
          temperature: Math.min(request.temperature, 2),
          maxOutputTokens: request.maxOutputTokens,
        },
      }),
    };
  },

  parseGenerate(status: number, text: string): Result<GenerateResult, AppError> {
    const payload = asRecord(parseJson(text));
    if (!payload) {
      return err(appError('invalid_response', 'The provider returned a response that is not valid JSON.'));
    }
    const candidates = asArray(payload['candidates']);
    const first = asRecord(candidates[0]);
    const content = asRecord(first?.['content']);
    const output = asArray(content?.['parts'])
      .map((part) => asString(asRecord(part)?.['text']) ?? '')
      .join('');

    if (output.trim().length === 0) {
      const blocked = asRecord(payload['promptFeedback'])?.['blockReason'];
      return err(
        appError(
          'invalid_response',
          typeof blocked === 'string'
            ? 'The provider blocked the request (safety filter).'
            : 'The provider returned an empty completion.',
        ),
      );
    }

    const finish = asString(first?.['finishReason']);
    const usage = asRecord(payload['usageMetadata']);
    return ok({
      text: output,
      finishReason: finish === 'MAX_TOKENS' ? 'length' : finish === 'SAFETY' || finish === 'RECITATION' ? 'filtered' : 'stop',
      usage: usage
        ? {
            input: asNumber(usage['promptTokenCount']) ?? 0,
            output: asNumber(usage['candidatesTokenCount']) ?? 0,
          }
        : undefined,
    });
  },

  buildModels(context: DialectContext): DialectRequest {
    const base = withTrailingSlash(context.profile.baseUrl);
    return {
      url: `${base}v1beta/models`,
      headers: { accept: 'application/json', ...context.authHeaders },
      body: '',
    };
  },

  parseModels(_status: number, text: string): Result<ModelInfo[], AppError> {
    const payload = asRecord(parseJson(text));
    const models = asArray(payload?.['models'])
      .map((entry) => {
        const record = asRecord(entry);
        const rawName = asString(record?.['name']);
        if (!rawName) {
          return undefined;
        }
        const id = rawName.replace(/^models\//, '');
        const methods = asArray(record?.['supportedGenerationMethods']).map((method) => asString(method));
        if (methods.length > 0 && !methods.includes('generateContent')) {
          return undefined;
        }
        return { id, label: asString(record?.['displayName']) ?? id };
      })
      .filter((model): model is ModelInfo => model !== undefined);
    return ok(models);
  },
};
