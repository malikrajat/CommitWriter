import { formatCommitMessage, type CommitMessage, type MessageProvenance } from '../domain/commit-message.js';
import type { ConventionalSettings } from '../ports/i-config.js';
import { validateConventional } from './conventional-validator.js';
import { parseMessage } from './output-parser.js';
import { repairMessage } from './output-repairer.js';

export interface ComposeInput {
  readonly raw: string;
  readonly settings: ConventionalSettings;
  readonly includeBody: boolean;
  readonly maxSubjectLength: number;
  readonly provenance: MessageProvenance;
}

const EMPTY_MESSAGE_WARNING = 'the model returned no usable commit message';
const MAX_BODY_LINES = 20;

/**
 * Pure composition step: parse -> repair -> validate. No IO, fully testable.
 */
export function composeMessage(input: ComposeInput): CommitMessage {
  const parsed = parseMessage(input.raw, input.maxSubjectLength);
  const repaired = repairMessage(parsed);

  let body = input.includeBody ? repaired.message.body : undefined;
  let bodyTruncated = false;
  if (body) {
    const lines = body.split('\n');
    if (lines.length > MAX_BODY_LINES) {
      body = lines.slice(0, MAX_BODY_LINES).join('\n');
      bodyTruncated = true;
    }
  }
  const footers = input.includeBody ? repaired.message.footers : [];

  const validation = validateConventional({
    subject: repaired.message.subject,
    body,
    footers,
    settings: input.settings,
  });

  const warnings: string[] = [
    ...repaired.repairs.map((repair) => `output repaired: ${repair}`),
    ...validation.warnings,
  ];
  if (bodyTruncated) {
    warnings.push(`body truncated to ${MAX_BODY_LINES} lines to keep the message concise`);
  }
  if (repaired.message.subject.trim().length === 0) {
    warnings.push(EMPTY_MESSAGE_WARNING);
  }

  const message: CommitMessage = {
    raw: '',
    subject: validation.subject,
    body,
    footers,
    conventional: validation.conventional,
    warnings,
    provenance: input.provenance,
  };

  return { ...message, raw: formatCommitMessage(message) };
}

export { EMPTY_MESSAGE_WARNING };
