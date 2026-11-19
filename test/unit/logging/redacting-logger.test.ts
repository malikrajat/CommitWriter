import { describe, expect, it } from 'vitest';
import type { OutputChannel } from 'vscode';
import type { LogLevel } from '../../../src/core/ports/i-logger.js';
import { RedactingLogger } from '../../../src/logging/redacting-logger.js';

function capture(): { channel: OutputChannel; lines: string[] } {
  const lines: string[] = [];
  const channel = {
    name: 'test',
    append: () => undefined,
    appendLine: (line: string) => lines.push(line),
    replace: () => undefined,
    clear: () => undefined,
    show: () => undefined,
    hide: () => undefined,
    dispose: () => undefined,
  } as unknown as OutputChannel;
  return { channel, lines };
}

describe('RedactingLogger', () => {
  it('never writes credentials or request headers', () => {
    const { channel, lines } = capture();
    const logger = new RedactingLogger(channel, () => 'debug');

    logger.info('provider request', {
      providerId: 'openai',
      authorization: 'Bearer sk-super-secret',
      headers: 'x-api-key: sk-super-secret',
      apiKey: 'sk-super-secret',
      cookie: 'session=abc',
      model: 'gpt-4o-mini',
    });

    const output = lines.join('\n');
    expect(output).toContain('providerId=openai');
    expect(output).toContain('model=gpt-4o-mini');
    expect(output).not.toContain('sk-super-secret');
    expect(output).not.toContain('Bearer');
    expect(output).not.toContain('x-api-key');
    expect(output).not.toContain('session=abc');
    expect(output).not.toContain('authorization');
  });

  it('redacts credential-shaped values in allowed fields', () => {
    const { channel, lines } = capture();
    const logger = new RedactingLogger(channel, () => 'debug');
    logger.warn('picked profile', { profileId: 'p1', endpoint: 'https://user:pass@example.com/v1' });

    const output = lines.join('\n');
    expect(output).toContain('p1');
    expect(output).not.toContain('pass');
  });

  it('honours the configured level', () => {
    const { channel, lines } = capture();
    const level: LogLevel = 'warn';
    const logger = new RedactingLogger(channel, () => level);

    logger.debug('hidden');
    logger.info('hidden');
    logger.warn('visible');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('visible');
  });
});
