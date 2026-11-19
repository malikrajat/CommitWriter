import type { ConventionalParts } from '../domain/commit-message.js';
import type { ConventionalSettings } from '../ports/i-config.js';
import { splitSubject } from './output-parser.js';

export interface ValidationInput {
  readonly subject: string;
  readonly body?: string;
  readonly footers: readonly string[];
  readonly settings: ConventionalSettings;
}

export interface ValidationResult {
  readonly subject: string;
  readonly conventional?: ConventionalParts;
  readonly warnings: readonly string[];
  readonly valid: boolean;
}

function truncateAtWord(subject: string, max: number): string {
  if (subject.length <= max) {
    return subject;
  }
  const cut = subject.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

/**
 * Enforces the Conventional Commits contract. Mechanical problems are repaired
 * (length, punctuation); semantic problems are reported as warnings.
 */
export function validateConventional(input: ValidationInput): ValidationResult {
  const warnings: string[] = [];
  const { settings } = input;

  if (!settings.enabled) {
    return { subject: input.subject, warnings, valid: input.subject.trim().length > 0 };
  }

  const parts = splitSubject(input.subject);
  if (!parts) {
    return {
      subject: input.subject,
      warnings: ['subject does not follow "type(scope): description"'],
      valid: false,
    };
  }

  let subject = input.subject.trim();
  const type = parts.type.toLowerCase();

  if (!settings.types.includes(type)) {
    warnings.push(`type "${type}" is not in the configured type list`);
  }
  if (settings.requireScope && !parts.scope) {
    warnings.push('a scope is required by configuration');
  }
  if (parts.scope && settings.allowedScopes.length > 0 && !settings.allowedScopes.includes(parts.scope)) {
    warnings.push(`scope "${parts.scope}" is not in the configured scope list`);
  }
  if (settings.maxSubjectLength > 0 && subject.length > settings.maxSubjectLength) {
    subject = truncateAtWord(subject, settings.maxSubjectLength);
    warnings.push(`subject shortened to ${settings.maxSubjectLength} characters`);
  }

  const footerHasBreaking = input.footers.some((footer) => /^BREAKING[ -]CHANGE:/i.test(footer));
  if (parts.breaking && !footerHasBreaking) {
    warnings.push('subject is marked breaking but no "BREAKING CHANGE:" footer was produced');
  }
  if (!parts.breaking && footerHasBreaking) {
    warnings.push('"BREAKING CHANGE:" footer is present but the subject is not marked with "!"');
  }

  const firstWord = parts.description.split(/\s+/)[0] ?? '';
  if (/(ed|ing)$/i.test(firstWord) && firstWord.length > 4) {
    warnings.push(`description may not be imperative ("${firstWord}")`);
  }
  if (/[.]$/.test(parts.description)) {
    subject = subject.replace(/\.+$/, '');
    warnings.push('removed trailing period from subject');
  }

  const reparsed = splitSubject(subject);
  return {
    subject,
    conventional: reparsed
      ? {
          type: reparsed.type.toLowerCase(),
          scope: reparsed.scope,
          breaking: reparsed.breaking,
          description: reparsed.description,
        }
      : undefined,
    warnings,
    valid: warnings.length === 0,
  };
}
