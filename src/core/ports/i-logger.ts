export type LogLevel = 'off' | 'error' | 'warn' | 'info' | 'debug';

export interface LogFields {
  readonly [key: string]: string | number | boolean | undefined;
}

/**
 * Redacting logger port. Implementations must drop any field whose value looks
 * like a credential and must never log prompt, diff or response bodies.
 */
export interface ILogger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export const nullLogger: ILogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
