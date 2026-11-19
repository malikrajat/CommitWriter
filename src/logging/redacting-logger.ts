import type * as vscode from 'vscode';
import type { ILogger, LogFields, LogLevel } from '../core/ports/i-logger.js';
import { redactSecrets } from '../core/security/secret-redactor.js';

const LEVEL_ORDER: Record<LogLevel, number> = { off: 0, error: 1, warn: 2, info: 3, debug: 4 };

/** Field names whose values are never written, regardless of content. */
const FORBIDDEN_FIELDS = /(key|token|secret|password|authorization|auth|header|cookie|prompt|diff|content|body|payload)/i;

function isPlainScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

export class RedactingLogger implements ILogger {
  constructor(
    private readonly channel: vscode.OutputChannel,
    private readonly level: () => LogLevel,
  ) {}

  debug(message: string, fields?: LogFields): void {
    this.write('debug', message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.write('info', message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.write('warn', message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.write('error', message, fields);
  }

  private write(level: Exclude<LogLevel, 'off'>, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] > LEVEL_ORDER[this.level()]) {
      return;
    }
    const parts: string[] = [message];
    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined || FORBIDDEN_FIELDS.test(key)) {
          continue;
        }
        if (isPlainScalar(value)) {
          parts.push(`${key}=${redactSecrets(String(value)).text}`);
        }
      }
    }
    this.channel.appendLine(`[${level}] ${parts.join(' ')}`);
  }
}
