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
 * Ollama's native API. It differs from the OpenAI format in endpoint, request
 * envelope (`options.num_predict`) and response shape (`message.content`),
 * which is why it has a dedicated dialect rather than reusing `openai-chat`.
 */
export const ollamaNativeDialect: Dialect = {
  id: 'ollama-native',

  buildGenerate(context: DialectContext, request: GenerateRequest): DialectRequest {
    const base = withTrailingSlash(context.profile.baseUrl);
    return {
      url: `${base}api/chat`,
      headers: {
        ...jsonHeaders(context.authHeaders),
        ...(context.profile.headers ?? {}),
      },
      body: JSON.stringify({
        model: request.model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        stream: false,
        options: {
          temperature: request.temperature,
          num_predict: request.maxOutputTokens,
        },
      }),
    };
  },

  parseGenerate(_status: number, text: string): Result<GenerateResult, AppError> {
    const payload = asRecord(parseJson(text));
    if (!payload) {
      return err(appError('invalid_response', 'The provider returned a response that is not valid JSON.'));
    }
    const message = asRecord(payload['message']);
    const output = asString(message?.['content']) ?? '';

    if (output.trim().length === 0) {
      return err(appError('invalid_response', 'The provider returned an empty completion.'));
    }

    return ok({
      text: output,
      finishReason: asString(payload['done_reason']) === 'length' ? 'length' : 'stop',
      usage: {
        input: asNumber(payload['prompt_eval_count']) ?? 0,
        output: asNumber(payload['eval_count']) ?? 0,
      },
    });
  },

  buildModels(context: DialectContext): DialectRequest {
    const base = withTrailingSlash(context.profile.baseUrl);
    return {
      url: `${base}api/tags`,
      headers: { accept: 'application/json', ...context.authHeaders },
      body: '',
    };
  },

  parseModels(_status: number, text: string): Result<ModelInfo[], AppError> {
    const payload = asRecord(parseJson(text));
    const models = asArray(payload?.['models'])
      .map((entry) => {
        const record = asRecord(entry);
        const name = asString(record?.['name']);
        return name ? { id: name, label: name } : undefined;
      })
      .filter((model): model is ModelInfo => model !== undefined);
    return ok(models);
  },
};
