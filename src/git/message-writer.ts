import type { IMessageWriter, WriteOutcome, WritePolicy } from '../core/ports/i-message-writer.js';
import type { GitRepository } from './git-types.js';

/**
 * The only writer of the SCM input box. This class intentionally has no access
 * to commit/stage/amend APIs: writing a message is the entire effect.
 */
export class ScmMessageWriter implements IMessageWriter {
  constructor(private repository: GitRepository) {}

  readCurrent(): string {
    return this.repository.inputBox.value;
  }

  isAvailable(): boolean {
    return true;
  }

  async write(message: string, policy: WritePolicy): Promise<WriteOutcome> {
    const previous = this.readCurrent();
    const next =
      policy === 'append' && previous.trim().length > 0
        ? `${previous.trimEnd()}\n\n${message.trim()}`
        : message.trim();

    this.repository.inputBox.value = next;
    return { written: true, previous };
  }

  async restore(previous: string): Promise<void> {
    this.repository.inputBox.value = previous;
  }
}
