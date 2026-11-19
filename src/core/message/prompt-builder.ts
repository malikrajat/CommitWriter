import type { DiffPlan, PromptSegment } from '../domain/budget.js';
import { segmentManifestLine } from '../context/manifest-builder.js';
import { wrapUntrustedDiff } from '../security/injection-guard.js';
import { formatChangeBrief, type ChangeBrief } from './change-brief.js';

export interface PromptOptions {
  readonly includeBody: boolean;
  readonly language: string;
  readonly brief?: ChangeBrief;
}

function manifestBlock(plan: DiffPlan): string {
  return `<change_manifest>\n${plan.manifest.join('\n')}\n</change_manifest>`;
}

function overviewBlock(brief: ChangeBrief | undefined): string | undefined {
  return brief ? formatChangeBrief(brief) : undefined;
}

function segmentBlock(segment: PromptSegment): string {
  return wrapUntrustedDiff(segment.path, segment.lines);
}

function closingInstruction(options: PromptOptions): string {
  return options.includeBody
    ? 'Write the commit message now. Subject first, optional body, optional BREAKING CHANGE footer.'
    : 'Write the commit subject now. One line only.';
}

export function buildUserPrompt(plan: DiffPlan, options: PromptOptions): string {
  const overview = overviewBlock(options.brief);
  const blocks = [
    manifestBlock(plan),
    ...(overview ? [overview] : []),
    ...plan.segments.map(segmentBlock),
    closingInstruction(options),
  ];
  if (plan.omitted.length > 0) {
    blocks.splice(1, 0, `<omitted_files>\n${plan.omitted.map((entry) => `${entry.path} (${entry.reason})`).join('\n')}\n</omitted_files>`);
  }
  return blocks.join('\n\n');
}

export function buildChunkPrompt(
  segments: readonly PromptSegment[],
  chunkIndex: number,
  chunkCount: number,
): string {
  const chunkManifest = `<chunk_manifest>\n${segments.map(segmentManifestLine).join('\n')}\n</chunk_manifest>`;
  return [
    chunkManifest,
    `<chunk index="${chunkIndex + 1}" of="${chunkCount}">`,
    ...segments.map(segmentBlock),
    '</chunk>',
    'Summarize each file in this chunk as "path: what changed".',
  ].join('\n\n');
}

export function buildSynthesisPrompt(
  plan: DiffPlan,
  summaries: readonly string[],
  options: PromptOptions,
): string {
  const overview = overviewBlock(options.brief);
  return [
    manifestBlock(plan),
    ...(overview ? [overview] : []),
    `<file_summaries>\n${summaries.join('\n')}\n</file_summaries>`,
    closingInstruction(options),
  ].join('\n\n');
}
