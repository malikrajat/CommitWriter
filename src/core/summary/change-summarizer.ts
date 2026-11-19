import type { CancelSignal } from '../domain/cancel-signal.js';
import type { DiffPlan } from '../domain/budget.js';
import { appError, type AppError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import { classifyPath } from '../context/file-classifier.js';
import { buildChunkPrompt } from '../message/prompt-builder.js';
import { planSummaryChunks } from './chunk-planner.js';
import { hashText } from './summary-cache.js';
import type {
  ChangeSummary,
  GroupSummary,
  SummaryChunkReport,
  SummaryModel,
  SummaryOptions,
} from './summary-types.js';

export const SUMMARY_PROMPT_VERSION = 1;

export function summaryCacheKey(modelKey: string, system: string, user: string): string {
  return hashText(`${SUMMARY_PROMPT_VERSION}\u0000${modelKey}\u0000${system}\u0000${user}`);
}

function retryable(error: AppError): boolean {
  return error.retryable || error.code === 'invalid_response' || error.code === 'timeout';
}

function cancelled(): AppError {
  return appError('cancelled', 'Generation cancelled.');
}

interface Aggregate {
  readonly groups: readonly GroupSummary[];
  readonly consolidated: string;
}

function aggregate(plan: DiffPlan, chunks: ReturnType<typeof planSummaryChunks>, reports: readonly SummaryChunkReport[]): Aggregate {
  const byGroup = new Map<
    string,
    { files: string[]; texts: string[]; notAnalyzed: string[]; analyzed: boolean }
  >();

  for (const chunk of chunks.chunks) {
    const report = reports.find((entry) => entry.index === chunk.index);
    const existing = byGroup.get(chunk.groupKey) ?? {
      files: [],
      texts: [],
      notAnalyzed: [],
      analyzed: false,
    };
    existing.files.push(...chunk.files);
    if (report?.text) {
      existing.texts.push(report.text);
      existing.analyzed = true;
    } else {
      // Never let a failed chunk disappear from the consolidated summary.
      existing.notAnalyzed.push(...chunk.files);
    }
    byGroup.set(chunk.groupKey, existing);
  }

  const groups: GroupSummary[] = [...byGroup.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, value]) => {
      const parts: string[] = [];
      if (value.texts.length > 0) {
        parts.push(value.texts.join('\n'));
      }
      if (value.notAnalyzed.length > 0) {
        parts.push(
          `[not analyzed: ${value.notAnalyzed.length} file${value.notAnalyzed.length === 1 ? '' : 's'} - ${value.notAnalyzed.slice(0, 5).join(', ')}${value.notAnalyzed.length > 5 ? ', ...' : ''}]`,
        );
      }
      return {
        key,
        files: value.files.sort((a, b) => (a < b ? -1 : 1)),
        text: parts.join('\n'),
        analyzed: value.analyzed,
        notAnalyzed: value.notAnalyzed,
      };
    });

  const files = new Set(plan.segments.map((segment) => segment.path)).size;
  const analyzedChunks = reports.filter((report) => report.text !== undefined);
  const analyzedFiles = analyzedChunks.reduce((total, report) => total + report.files.length, 0);
  const header = `Analyzed ${analyzedFiles} of ${files} file${files === 1 ? '' : 's'} in ${groups.length} group${groups.length === 1 ? '' : 's'}.`;

  const sections = groups.map((group) => {
    const body = group.text.length > 0 ? group.text : '[not analyzed: see limitations]';
    return `## ${group.key} (${group.files.length} file${group.files.length === 1 ? '' : 's'})\n${body}`;
  });

  return { groups, consolidated: [header, ...sections].join('\n\n') };
}

function limitationsFor(
  plan: DiffPlan,
  reports: readonly SummaryChunkReport[],
  truncatedFiles: number,
): readonly string[] {
  const limitations: string[] = [];
  const importantOmitted = plan.omitted.filter((entry) => classifyPath(entry.path).important);

  if (importantOmitted.length > 0) {
    const sample = importantOmitted.slice(0, 5).map((entry) => entry.path).join(', ');
    limitations.push(
      `${importantOmitted.length} file${importantOmitted.length === 1 ? ' was' : 's were'} not analyzed because of the token budget or exclusion rules: ${sample}${importantOmitted.length > 5 ? ', ...' : ''}`,
    );
  }

  const failed = reports.filter((report) => report.text === undefined);
  if (failed.length > 0) {
    limitations.push(
      `${failed.length} chunk${failed.length === 1 ? '' : 's'} could not be summarized; their files are listed but not described.`,
    );
  }

  if (truncatedFiles > 0) {
    limitations.push(`${truncatedFiles} file diff${truncatedFiles === 1 ? ' was' : 's were'} truncated to fit the budget.`);
  }

  if (plan.omitted.length > 0 && importantOmitted.length === 0) {
    limitations.push(`${plan.omitted.length} generated, binary or sensitive file(s) were excluded.`);
  }

  if (plan.segments.length === 0) {
    limitations.push('No analyzable changes were found in the selected scope.');
  }

  return limitations;
}

/**
 * Map-reduce engine: chunk -> summarize (with retry and cache) -> aggregate.
 * Chunk failures never abort the run; they are recorded in coverage and
 * surfaced as user-visible limitations.
 */
export async function summarizeChanges(input: {
  readonly plan: DiffPlan;
  readonly model: SummaryModel;
  readonly options: SummaryOptions;
  readonly signal: CancelSignal;
}): Promise<Result<ChangeSummary, AppError>> {
  const { plan, model, options, signal } = input;
  const chunkPlan = planSummaryChunks(plan, options.chunkTokens);
  const reports: SummaryChunkReport[] = [];
  const texts: string[] = [];

  const report = (completed: number, label: string): void => {
    options.onProgress?.({ phase: 'summarizing', completed, total: chunkPlan.chunks.length, label });
  };

  let completed = 0;
  for (const chunk of chunkPlan.chunks) {
    if (signal.aborted) {
      return err(cancelled());
    }
    report(completed, chunk.groupKey);

    const user = buildChunkPrompt(chunk.segments, chunk.index, chunkPlan.chunks.length);
    const cacheKey = summaryCacheKey(model.cacheKey, options.system, user);
    const cached = options.cache?.get(cacheKey);
    if (cached !== undefined && cached.trim().length > 0) {
      reports.push({
        index: chunk.index,
        groupKey: chunk.groupKey,
        files: chunk.files,
        tokens: chunk.tokens,
        text: cached,
        cached: true,
        attempts: 0,
      });
      texts.push(cached);
      completed += 1;
      report(completed, chunk.groupKey);
      continue;
    }

    let attempts = 0;
    let text: string | undefined;
    let lastError: AppError | undefined;

    while (attempts < options.maxAttempts && !signal.aborted) {
      attempts += 1;
      const result = await model.summarize(
        { system: options.system, user, maxTokens: options.maxTokens },
        signal,
      );
      if (result.ok) {
        const trimmed = result.value.trim();
        if (trimmed.length > 0) {
          text = trimmed;
        } else {
          lastError = appError('invalid_response', 'The model returned an empty summary.');
        }
        break;
      }
      lastError = result.error;
      if (result.error.code === 'cancelled') {
        return err(result.error);
      }
      if (!retryable(result.error)) {
        break;
      }
    }

    if (text !== undefined) {
      options.cache?.set(cacheKey, text);
      reports.push({
        index: chunk.index,
        groupKey: chunk.groupKey,
        files: chunk.files,
        tokens: chunk.tokens,
        text,
        cached: false,
        attempts,
      });
      texts.push(text);
    } else {
      reports.push({
        index: chunk.index,
        groupKey: chunk.groupKey,
        files: chunk.files,
        tokens: chunk.tokens,
        cached: false,
        attempts,
        error: {
          code: lastError?.code ?? 'internal',
          message: lastError?.message ?? 'The chunk could not be summarized.',
        },
      });
    }

    completed += 1;
    report(completed, chunk.groupKey);
  }

  options.onProgress?.({
    phase: 'aggregating',
    completed: chunkPlan.chunks.length,
    total: chunkPlan.chunks.length,
    label: 'aggregating',
  });

  const { groups, consolidated } = aggregate(plan, chunkPlan, reports);
  const failed = reports.filter((entry) => entry.text === undefined);
  const analyzed = reports.filter((entry) => entry.text !== undefined);
  const truncatedFiles = plan.segments.filter((segment) => segment.omittedLines > 0).length;

  return ok({
    chunks: reports,
    groups,
    texts,
    consolidated,
    coverage: {
      files: new Set(plan.segments.map((segment) => segment.path)).size + plan.omitted.length,
      analyzed: analyzed.reduce((total, entry) => total + entry.files.length, 0),
      failed: failed.reduce((total, entry) => total + entry.files.length, 0),
      omitted: plan.omitted.length,
      truncatedFiles,
    },
    limitations: limitationsFor(plan, reports, truncatedFiles),
  });
}
