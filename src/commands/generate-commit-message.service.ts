import type { CancelSignal } from '../core/domain/cancel-signal.js';
import type { ChangeSet } from '../core/domain/change-set.js';
import type { ContextSelection } from '../core/domain/context-selection.js';
import { hasSelection } from '../core/domain/context-selection.js';
import type { CommitMessage, MessageStrategy } from '../core/domain/commit-message.js';
import type { DiffPlan } from '../core/domain/budget.js';
import { appError, type AppError } from '../core/domain/errors.js';
import type { ModePreset } from '../core/domain/generation-mode.js';
import type { ProviderProfile } from '../core/domain/provider-profile.js';
import { err, ok, type Result } from '../core/domain/result.js';
import { estimateTokens } from '../core/context/token-estimator.js';
import { buildPlan } from '../core/context/token-budgeter.js';
import { composeMessage } from '../core/message/message-composer.js';
import { buildSynthesisPrompt, buildUserPrompt } from '../core/message/prompt-builder.js';
import { buildSummarySystemPrompt, buildSystemPrompt } from '../core/message/prompt-templates.js';
import { PRODUCT } from '../core/product.js';
import type { PromptOptions } from '../core/message/prompt-builder.js';
import { buildChangeBrief, type ChangeBrief } from '../core/message/change-brief.js';
import { validateGrounding } from '../core/message/grounding-validator.js';
import { applyTrailers, issueKeyFromBranch } from '../core/message/trailers.js';
import { resolveMode, resolveRequestTimeout } from '../core/modes/mode-presets.js';import { detectInjectionSignals } from '../core/security/injection-guard.js';
import { redactSecrets } from '../core/security/secret-redactor.js';
import { summarizeChanges } from '../core/summary/change-summarizer.js';
import { SummaryCache } from '../core/summary/summary-cache.js';
import type { ChangeSummary, SummaryModel, SummaryProgress } from '../core/summary/summary-types.js';
import type { IConfig, ResolvedConfig } from '../core/ports/i-config.js';
import type { GitRepositoryPort, IDiffCollector } from '../core/ports/i-git.js';
import type { IHistorySource } from '../core/ports/i-history-source.js';
import type { GenerateRequest, GenerateResult } from '../core/ports/i-provider.js';
import type { ILogger } from '../core/ports/i-logger.js';
import type { IClock } from '../core/ports/i-clock.js';
import { VscodeDiffCollector } from '../git/diff-collector.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { resolveEffectiveProfile } from '../providers/profile-resolver.js';

export interface RepoContext {
  readonly port: GitRepositoryPort;
  readonly history: IHistorySource;
}

export interface PreparedGeneration {
  readonly changeSet: ChangeSet;
  readonly plan: DiffPlan;
  readonly mode: ModePreset;
  readonly profile: ProviderProfile;
  readonly system: string;
  readonly user: string;
  readonly options: PromptOptions;
  readonly brief: ChangeBrief;
  readonly includeBody: boolean;
  readonly injectionSignals: readonly string[];
  readonly histories: readonly string[];
}

export interface GenerationOutcome {
  readonly message: CommitMessage;
  readonly prepared: PreparedGeneration;
  readonly usage?: { readonly input: number; readonly output: number };
  readonly durationMs: number;
  readonly payloadPreview: string;
  readonly summary?: ChangeSummary;
}

export interface PrepareOptions {
  readonly config: ResolvedConfig;
  readonly profile: ProviderProfile;
  readonly selection: ContextSelection;
  readonly allowSensitive: boolean;
}

export interface GenerateServiceDeps {
  readonly config: IConfig;
  readonly registry: ProviderRegistry;
  readonly logger: ILogger;
  readonly clock: IClock;
  readonly summaryCache?: SummaryCache;
}

export class GenerateCommitMessageService {
  private readonly summaryCache: SummaryCache;

  constructor(private readonly deps: GenerateServiceDeps) {
    this.summaryCache = deps.summaryCache ?? new SummaryCache(deps.clock);
  }

  async prepare(
    repo: RepoContext,
    options: PrepareOptions,
    signal: CancelSignal,
  ): Promise<Result<PreparedGeneration, AppError>> {
    const profileResult = resolveEffectiveProfile(options.profile, {
      localOnly: options.config.privacy.localOnly,
    });
    if (!profileResult.ok) {
      return profileResult;
    }
    const profile = profileResult.value;
    const config = options.config;

    if (!hasSelection(options.selection)) {
      return err(
        appError(
          'config',
          `No change sources are selected. Enable staged, unstaged or untracked changes in ${PRODUCT.displayName} settings.`,
        ),
      );
    }

    const mode = resolveMode(config.mode, config.modeOverrides[config.mode], {
      maxDiffTokens: config.context.maxDiffTokens,
      contextWindow: profile.contextWindow,
    });

    const budget = {
      maxDiffTokens: mode.maxDiffTokens,
      maxFiles: Math.min(mode.maxFiles, config.context.maxFiles),
      maxFileDiffLines: Math.min(mode.maxFileDiffLines, config.context.maxFileDiffLines),
      allowMapReduce: mode.useMapReduce,
      forceMapReduce: mode.depth === 'deep',
    };

    const collector: IDiffCollector = new VscodeDiffCollector(repo.port, this.deps.logger);
    const collected = await collector.collect(
      {
        selection: options.selection,
        maxFiles: budget.maxFiles,
        maxFileBytes: config.context.maxFileBytes,
        excludeGlobs: config.context.excludeGlobs,
        allowSensitive: options.allowSensitive,
      },
      signal,
    );
    if (!collected.ok) {
      return collected;
    }
    const changeSet = collected.value;

    if (changeSet.files.length === 0) {
      const scopeText =
        options.selection.includeStaged && !options.selection.includeUnstaged && !options.selection.includeUntracked
          ? 'No staged changes to describe.'
          : 'No changed files to describe.';
      const omissionText =
        changeSet.omitted.length > 0
          ? ` ${changeSet.omitted.length} file${changeSet.omitted.length === 1 ? ' was' : 's were'} excluded by ignore, size or sensitive-file rules.`
          : '';
      return err(appError('no_changes', `${scopeText}${omissionText}`));
    }

    const historyLimit =
      mode.useStyleHistory && config.style.learnFromHistory
        ? Math.min(mode.historySamples, config.style.historySamples)
        : 0;

    let histories: readonly string[] = [];
    if (historyLimit > 0) {
      const history = await repo.history.recentSubjects(historyLimit, signal);
      if (history.ok) {
        histories = history.value;
      } else if (history.error.code === 'cancelled') {
        return history;
      } else {
        this.deps.logger.warn('history unavailable', { code: history.error.code });
      }
    }

    const brief = buildChangeBrief(changeSet.files);
    const system = buildSystemPrompt({
      mode,
      conventional: config.conventional,
      output: config.output,
      history: histories,
      brief,
    });
    const includeBody = mode.includeBody && config.output.includeBody;
    const optionsForPrompt: PromptOptions = { includeBody, language: config.output.language, brief };
    const overheadTokens = estimateTokens(system) + 220;

    const plan = buildPlan({
      files: changeSet.files,
      omitted: changeSet.omitted,
      budget,
      overheadTokens,
    });

    const user = buildUserPrompt(plan, optionsForPrompt);

    return ok({
      changeSet,
      plan,
      mode,
      profile,
      system,
      user,
      options: optionsForPrompt,
      includeBody,
      brief,
      injectionSignals: detectInjectionSignals(user),
      histories,
    });
  }

  async execute(
    prepared: PreparedGeneration,
    signal: CancelSignal,
    onProgress?: (event: SummaryProgress) => void,
  ): Promise<Result<GenerationOutcome, AppError>> {
    const started = this.deps.clock.now();
    const strategy: MessageStrategy = prepared.plan.strategy === 'map-reduce' ? 'map-reduce' : 'single-pass';

    let text: string;
    let usage: { input: number; output: number } | undefined;
    let summary: ChangeSummary | undefined;

    if (strategy === 'map-reduce') {
      const reduced = await this.runMapReduce(prepared, signal, onProgress);
      if (!reduced.ok) {
        return reduced;
      }
      text = reduced.value.text;
      usage = reduced.value.usage;
      summary = reduced.value.summary;
    } else {
      const single = await this.callProvider(prepared, prepared.user, signal);
      if (!single.ok) {
        return single;
      }
      text = single.value.text;
      usage = single.value.usage;
    }

    const message = composeMessage({
      raw: text,
      settings: this.deps.config.read().conventional,
      includeBody: prepared.includeBody,
      maxSubjectLength: this.deps.config.read().conventional.maxSubjectLength,
      provenance: {
        providerId: prepared.profile.provider,
        model: prepared.profile.model,
        strategy,
        mode: prepared.mode.id,
      },
    });

    if (message.subject.trim().length === 0) {
      return err(
        appError('invalid_response', 'The model did not return a usable commit message.', {
          providerId: prepared.profile.provider,
          model: prepared.profile.model,
        }),
      );
    }

    const warnings = [...message.warnings];
    const grounding = validateGrounding({
      subject: message.subject,
      conventional: message.conventional,
      body: message.body,
      brief: prepared.brief,
    });
    warnings.push(...grounding);
    if (prepared.injectionSignals.length > 0) {
      warnings.push('diff content contained instruction-like text; it was treated as data');
    }
    const finalMessage: CommitMessage = { ...message, warnings };

    const config = this.deps.config.read();
    const withTrailers = applyTrailers(finalMessage, {
      issueKey: config.output.includeIssueKeyFromBranch
        ? issueKeyFromBranch(prepared.changeSet.branch)
        : undefined,
      attribution: config.output.attribution === 'trailer',
    });

    return ok({
      message: withTrailers,
      prepared,
      usage,
      durationMs: this.deps.clock.now() - started,
      payloadPreview: redactSecrets(`${prepared.system}\n\n${prepared.user}`).text,
      summary,
    });
  }

  private async runMapReduce(
    prepared: PreparedGeneration,
    signal: CancelSignal,
    onProgress?: (event: SummaryProgress) => void,
  ): Promise<
    Result<{ text: string; usage?: { input: number; output: number }; summary: ChangeSummary }, AppError>
  > {
    let input = 0;
    let output = 0;

    const model: SummaryModel = {
      cacheKey: `${prepared.profile.provider}:${prepared.profile.model}:${prepared.profile.dialect}`,
      summarize: async (request, childSignal) => {
        const result = await this.callProvider(
          prepared,
          request.user,
          childSignal,
          request.system,
          request.maxTokens,
        );
        if (!result.ok) {
          return result;
        }
        input += result.value.usage?.input ?? 0;
        output += result.value.usage?.output ?? 0;
        return ok(result.value.text);
      },
    };

    const contextAllowance = Math.floor(prepared.profile.contextWindow / 2);
    const chunkTokens = Math.max(
      1000,
      Math.min(
        Math.floor(prepared.plan.budgetTokens / 3),
        contextAllowance - estimateTokens(prepared.system) - 400,
      ),
    );

    const summary = await summarizeChanges({
      plan: prepared.plan,
      model,
      signal,
      options: {
        system: buildSummarySystemPrompt(),
        maxTokens: Math.min(prepared.mode.maxOutputTokens, 1024),
        chunkTokens,
        maxAttempts: 2,
        cache: this.summaryCache,
        onProgress,
      },
    });
    if (!summary.ok) {
      return summary;
    }

    const complete =
      summary.value.chunks.length > 0 && summary.value.texts.length === summary.value.chunks.length;
    const summaryTexts =
      summary.value.chunks.length === 0
        ? []
        : complete
          ? summary.value.texts
          : [summary.value.consolidated];

    const synthesis = await this.callProvider(
      prepared,
      buildSynthesisPrompt(prepared.plan, summaryTexts, prepared.options),
      signal,
    );
    if (!synthesis.ok) {
      return synthesis;
    }

    if (summary.value.limitations.length > 0) {
      this.deps.logger.warn('change summary incomplete', {
        limitations: summary.value.limitations.length,
        failedChunks: summary.value.coverage.failed,
        omitted: summary.value.coverage.omitted,
      });
    }

    return {
      ok: true,
      value: {
        text: synthesis.value.text,
        usage: {
          input: input + (synthesis.value.usage?.input ?? 0),
          output: output + (synthesis.value.usage?.output ?? 0),
        },
        summary: summary.value,
      },
    };
  }

  private async callProvider(
    prepared: PreparedGeneration,
    user: string,
    signal: CancelSignal,
    system: string = prepared.system,
    maxOutputTokens: number = prepared.mode.maxOutputTokens,
  ): Promise<Result<GenerateResult, AppError>> {
    const config = this.deps.config.read();
    const provider = this.deps.registry.get(prepared.profile);

    const buildRequest = (model: string): GenerateRequest => ({
      model,
      system,
      user,
      maxOutputTokens,
      temperature: Math.min(prepared.mode.temperature, 0.3),
      timeoutMs: resolveRequestTimeout(
        prepared.mode.timeoutMs,
        config.provider.timeoutMs,
        prepared.profile.timeoutMs,
      ),
      maxRetries: Math.min(prepared.mode.maxRetries, config.provider.maxRetries),
      signal,
    });

    const first = await provider.generate(prepared.profile, buildRequest(prepared.profile.model));
    if (first.ok) {
      return first;
    }
    if (first.error.code === 'cancelled') {
      return first;
    }

    const fallback = prepared.profile.fallbackModel;
    if (fallback && fallback !== prepared.profile.model && first.error.retryable) {
      this.deps.logger.warn('primary model failed, trying fallback model', { code: first.error.code });
      const second = await provider.generate(
        { ...prepared.profile, model: fallback },
        buildRequest(fallback),
      );
      if (second.ok) {
        return second;
      }
    }

    return first;
  }
}
