export type WritePolicy = 'replace' | 'append';

export interface WriteOutcome {
  readonly written: boolean;
  readonly previous: string;
  readonly reason?: 'cancelled' | 'unchanged';
}

/**
 * The ONLY component allowed to mutate the SCM input box.
 * Implementations never commit, stage, amend or restore anything.
 */
export interface IMessageWriter {
  readCurrent(): string;
  isAvailable(): boolean;
  write(message: string, policy: WritePolicy): Promise<WriteOutcome>;
  restore(previous: string): Promise<void>;
}
