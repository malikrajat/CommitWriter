import { formatCommitMessage, type CommitMessage } from '../domain/commit-message.js';

const ISSUE_KEY = /[A-Z][A-Z0-9]{1,9}-\d+/;

export function issueKeyFromBranch(branch: string | undefined): string | undefined {
  if (!branch) {
    return undefined;
  }
  return ISSUE_KEY.exec(branch.toUpperCase())?.[0];
}

import { PRODUCT } from '../product.js';
export interface TrailerOptions {
  readonly issueKey?: string;
  readonly attribution: boolean;
}

/**
 * Adds optional footers after validation. Pure and deterministic; never
 * rewrites the subject or body.
 */
export function applyTrailers(message: CommitMessage, options: TrailerOptions): CommitMessage {
  const footers = [...message.footers];

  const issueKey = options.issueKey;
  if (issueKey) {
    const alreadyReferenced =
      message.subject.includes(issueKey) || footers.some((footer) => footer.includes(issueKey));
    if (!alreadyReferenced) {
      footers.push(`Refs: ${issueKey}`);
    }
  }

  if (options.attribution && !footers.some((footer) => /^generated-by:/i.test(footer))) {
    footers.push(`Generated-by: ${PRODUCT.displayName}`);
  }

  if (footers.length === message.footers.length) {
    return message;
  }

  const updated: CommitMessage = { ...message, footers };
  return { ...updated, raw: formatCommitMessage(updated) };
}
