import { appError, type AppError } from '../../core/domain/errors.js';
import type { Result } from '../../core/domain/result.js';
import { err, ok } from '../../core/domain/result.js';
import type { GenerateResult, ModelInfo } from '../../core/ports/i-provider.js';
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
import type { GenerateRequest } from '../../core/ports/i-provider.js';

export const openAiChatDialect: Dialect = {
  id: 'openai-chat',

  buildGenerate(context: DialectContext, request: GenerateRequest): DialectRequest {
    const base = withTrailingSlash(context.profile.baseUrl);
    return {
      url: `${base}chat/completions`,
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
        temperature: request.temperature,
        max_tokens: request.maxOutputTokens,
        stream: false,
      }),
    };
  },

  parseGenerate(status: number, text: string): Result<GenerateResult, AppError> {
    const payload = asRecord(parseJson(text));
    if (!payload) {
      return err(appError('invalid_response', 'The provider returned a response that is not valid JSON.'));
    }
    const choices = asArray(payload['choices']);
    const first = asRecord(choices[0]);
    const message = asRecord(first?.['message']);
    const content = message?.['content'];

    let output = '';
    if (typeof content === 'string') {
      output = content;
    } else if (Array.isArray(content)) {
      output = content
        .map((part) => asString(asRecord(part)?.['text']) ?? '')
        .join('');
    }

    if (output.trim().length === 0) {
      return err(appError('invalid_response', 'The provider returned an empty completion.'));
    }

    const finish = asString(first?.['finish_reason']);
    const usage = asRecord(payload['usage']);
    return ok({
      text: output,
      finishReason: finish === 'length' ? 'length' : finish === 'content_filter' ? 'filtered' : 'stop',
      usage: usage
        ? {
            input: asNumber(usage['prompt_tokens']) ?? 0,
            output: asNumber(usage['completion_tokens']) ?? 0,
          }
        : undefined,
      requestId: asString(payload['id']),
    });
  },

  buildModels(context: DialectContext): DialectRequest {
    const base = withTrailingSlash(context.profile.baseUrl);
    return {
      url: `${base}models`,
      headers: { accept: 'application/json', ...context.authHeaders },
      body: '',
    };
  },

  parseModels(_status: number, text: string): Result<ModelInfo[], AppError> {
    const payload = asRecord(parseJson(text));
    const data = asArray(payload?.['data']);
    const models = data
      .map((entry) => {
        const record = asRecord(entry);
        const id = asString(record?.['id']);
        return id ? { id, label: id } : undefined;
      })
      .filter((model): model is ModelInfo => model !== undefined);
    return ok(models);
  },
};
