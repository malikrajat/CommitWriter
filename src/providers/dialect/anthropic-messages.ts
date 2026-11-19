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

const ANTHROPIC_VERSION = '2023-06-01';

export const anthropicMessagesDialect: Dialect = {
  id: 'anthropic-messages',

  buildGenerate(context: DialectContext, request: GenerateRequest): DialectRequest {
    const base = withTrailingSlash(context.profile.baseUrl);
    return {
      url: `${base}v1/messages`,
      headers: {
        ...jsonHeaders(context.authHeaders),
        'anthropic-version': ANTHROPIC_VERSION,
        ...(context.profile.headers ?? {}),
      },
      body: JSON.stringify({
        model: request.model,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
        max_tokens: request.maxOutputTokens,
        temperature: Math.min(request.temperature, 1),
      }),
    };
  },

  parseGenerate(status: number, text: string): Result<GenerateResult, AppError> {
    const payload = asRecord(parseJson(text));
    if (!payload) {
      return err(appError('invalid_response', 'The provider returned a response that is not valid JSON.'));
    }
    const blocks = asArray(payload['content'])
      .map((block) => asRecord(block))
      .filter((block): block is Record<string, unknown> => block !== undefined);
    const output = blocks
      .filter((block) => asString(block['type']) === 'text')
      .map((block) => asString(block['text']) ?? '')
      .join('');

    if (output.trim().length === 0) {
      return err(appError('invalid_response', 'The provider returned an empty completion.'));
    }

    const stop = asString(payload['stop_reason']);
    const usage = asRecord(payload['usage']);
    return ok({
      text: output,
      finishReason: stop === 'max_tokens' ? 'length' : stop === 'refusal' ? 'filtered' : 'stop',
      usage: usage
        ? {
            input: asNumber(usage['input_tokens']) ?? 0,
            output: asNumber(usage['output_tokens']) ?? 0,
          }
        : undefined,
      requestId: asString(payload['id']),
    });
  },

  buildModels(context: DialectContext): DialectRequest {
    const base = withTrailingSlash(context.profile.baseUrl);
    return {
      url: `${base}v1/models`,
      headers: { accept: 'application/json', 'anthropic-version': ANTHROPIC_VERSION, ...context.authHeaders },
      body: '',
    };
  },

  parseModels(_status: number, text: string): Result<ModelInfo[], AppError> {
    const payload = asRecord(parseJson(text));
    const models = asArray(payload?.['data'])
      .map((entry) => {
        const record = asRecord(entry);
        const id = asString(record?.['id']);
        return id ? { id, label: asString(record?.['display_name']) ?? id } : undefined;
      })
      .filter((model): model is ModelInfo => model !== undefined);
    return ok(models);
  },
};
