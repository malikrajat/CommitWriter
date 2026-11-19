import type { GenerationMode } from './generation-mode.js';

export interface ConventionalParts {
  readonly type: string;
  readonly scope?: string;
  readonly breaking: boolean;
  readonly description: string;
}

export type MessageStrategy = 'single-pass' | 'map-reduce' | 'heuristic';

export interface MessageProvenance {
  readonly providerId: string;
  readonly model: string;
  readonly strategy: MessageStrategy;
  readonly mode: GenerationMode;
}

export interface CommitMessage {
  readonly raw: string;
  readonly subject: string;
  readonly body?: string;
  readonly footers: readonly string[];
  readonly conventional?: ConventionalParts;
  readonly warnings: readonly string[];
  readonly provenance: MessageProvenance;
}

export function formatCommitMessage(message: CommitMessage): string {
  const parts: string[] = [message.subject];
  if (message.body && message.body.trim().length > 0) {
    parts.push('', message.body.trim());
  }
  if (message.footers.length > 0) {
    parts.push('', ...message.footers);
  }
  return parts.join('\n');
}
