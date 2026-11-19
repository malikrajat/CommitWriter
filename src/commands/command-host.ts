import * as vscode from 'vscode';
import { CancelToken } from '../core/domain/cancel-signal.js';
import { PRODUCT } from '../core/product.js';
import type { AppError } from '../core/domain/errors.js';
import type { ContextSelection } from '../core/domain/context-selection.js';
import type { ProviderProfile } from '../core/domain/provider-profile.js';
import { heuristicMessage } from '../core/message/heuristic-fallback.js';
import { redactSecrets } from '../core/security/secret-redactor.js';
import { evaluateUrl } from '../core/security/url-policy.js';
import type { ConsentRequest } from '../core/domain/consent.js';
import type { WritePolicy } from '../core/ports/i-message-writer.js';
import type { IConfig } from '../core/ports/i-config.js';
import type { IConsentService } from '../core/ports/i-consent-service.js';
import type { IProfileService } from '../core/ports/i-config.js';
import type { ISecretStore } from '../core/ports/i-secret-store.js';
import type { ILogger } from '../core/ports/i-logger.js';
import type { IClock } from '../core/ports/i-clock.js';
import type { GitApiProvider } from '../git/git-api-provider.js';
import { GitHistorySource } from '../git/history-source.js';
import { ScmMessageWriter } from '../git/message-writer.js';
import { RepositoryResolver } from '../git/repository-resolver.js';
import { VscodeGitRepository } from '../git/vscode-git-repository.js';
import { WorkspaceFileReader } from '../git/file-reader.js';
import type { GitAPI, GitRepository } from '../git/git-types.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { ModelCatalog } from '../providers/model-catalog.js';
import { resolveEffectiveProfile } from '../providers/profile-resolver.js';
import type { StatusBar } from '../ui/status-bar.js';
import { askConsent, askDraftPolicy, confirm, pickRepository, showPreview } from '../ui/dialogs.js';
import { progressIncrement, summaryProgressMessage } from '../ui/progress.js';
import type { SettingsController } from '../config/settings-controller.js';
import { isToggleKey, type ToggleKey } from '../ui/settings-model.js';
import type {
  GenerateCommitMessageService,
  GenerationOutcome,
  PreparedGeneration,
} from './generate-commit-message.service.js';

const brand = (text: string): string => `${PRODUCT.displayName}: ${text}`;

export interface CommandDeps {
  readonly config: IConfig;
  readonly profiles: IProfileService;
  readonly consent: IConsentService;
  readonly secrets: ISecretStore;
  readonly logger: ILogger;
  readonly clock: IClock;
  readonly gitApi: GitApiProvider;
  readonly registry: ProviderRegistry;
  readonly models: ModelCatalog;
  readonly service: GenerateCommitMessageService;
  readonly statusBar: StatusBar;
  readonly settings: SettingsController;
  readonly output: vscode.OutputChannel;
}

interface LastResult {
  readonly repoRoot: string;
  readonly previous: string;
  readonly outcome: GenerationOutcome;
  readonly prepared: PreparedGeneration;
}

export class CommandHost {
  private active: CancelToken | undefined;
  private last: LastResult | undefined;
  private allowSensitiveNext = false;
  private configSubscription: { dispose(): void } | undefined;

  constructor(private readonly deps: CommandDeps) {}

  register(context: vscode.ExtensionContext): void {
    const register = (id: string, handler: (...args: unknown[]) => unknown): void => {
      context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    };

    register(PRODUCT.command.generate, () => this.generate());
    register(PRODUCT.command.generateStaged, () => this.generate(true));
    register(PRODUCT.command.regenerate, () => this.regenerate());
    register(PRODUCT.command.editMessage, () => this.editMessage());
    register(PRODUCT.command.cancel, () => this.cancel());
    register(PRODUCT.command.undo, () => this.undo());
    register(PRODUCT.command.previewPayload, () => this.preview());
    register(PRODUCT.command.selectRepository, () => this.selectRepository());
    register(PRODUCT.command.selectProfile, () => this.deps.settings.selectProvider());
    register(PRODUCT.command.selectModel, () => this.selectModel());
    register(PRODUCT.command.manageProfiles, () => this.deps.settings.openHub());
    register(PRODUCT.command.addProfile, () => this.deps.settings.addProvider());
    register(PRODUCT.command.editProfile, () => this.deps.settings.editProvider());
    register(PRODUCT.command.removeProfile, () => this.deps.settings.removeProvider());
    register(PRODUCT.command.testConnection, () => this.deps.settings.testConnection());
    register(PRODUCT.command.validateProfiles, () => this.deps.settings.validateProfiles());
    register(PRODUCT.command.setApiKey, () => this.deps.settings.setApiKey());
    register(PRODUCT.command.clearApiKey, () => this.deps.settings.clearApiKey());
    register(PRODUCT.command.useProfile, (id) => this.useProfile(typeof id === 'string' ? id : undefined));
    register(PRODUCT.command.toggleSetting, (key) => this.toggleSetting(key));
    register(PRODUCT.command.setTokenBudget, () => this.deps.settings.editTokenBudget());
    register(PRODUCT.command.setRequestTimeout, () => this.deps.settings.editTimeout());
    register(PRODUCT.command.setMode, () => this.deps.settings.editMode());
    register(PRODUCT.command.allowSensitiveFilesOnce, () => this.allowSensitiveOnce());
    register(PRODUCT.command.revokeEgressConsent, () => this.revokeConsent());
    register(PRODUCT.command.showDiagnostics, () => this.showDiagnostics());
    register(PRODUCT.command.showOutput, () => this.deps.output.show());

    this.configSubscription = this.deps.config.onDidChange(() => this.refreshStatusBar());
    context.subscriptions.push({ dispose: () => this.configSubscription?.dispose() });
    void this.refreshStatusBar();
    void this.setContext(PRODUCT.context.hasLastResult, false);
    void this.setContext(PRODUCT.context.generating, false);
  }

  dispose(): void {
    this.active?.abort('disposed');
    this.configSubscription?.dispose();
    this.deps.statusBar.dispose();
  }

  private selectionFor(config: ReturnType<IConfig['read']>, stagedOnly: boolean): ContextSelection {
    if (stagedOnly) {
      return { includeStaged: true, includeUnstaged: false, includeUntracked: false };
    }
    return {
      includeStaged: config.context.includeStaged,
      includeUnstaged: config.context.includeUnstaged,
      includeUntracked: config.context.includeUntracked,
    };
  }

  private async refreshStatusBar(): Promise<void> {
    const config = this.deps.config.read();
    this.deps.statusBar.setEnabled(config.statusBarEnabled);
    if (!config.statusBarEnabled) {
      return;
    }
    const profiles = await this.deps.profiles.list();
    const activeId = vscode.workspace.getConfiguration(PRODUCT.configSection).get<string>('activeProfileId', '');
    const active = profiles.find((profile) => profile.id === activeId) ?? profiles[0];
    this.deps.statusBar.set(config.mode, active?.label ?? 'no profile', active?.model);
  }

  private async generate(stagedOnly = false): Promise<void> {
    if (this.active) {
      void vscode.window.showInformationMessage(brand('Already generating a message.'));
      return;
    }
    const token = new CancelToken();
    this.active = token;
    await this.setContext(PRODUCT.context.generating, true);
    this.deps.statusBar.setBusy(true);

    try {
      const repository = await this.resolveRepository();
      if (!repository) {
        return;
      }
      const api = await this.deps.gitApi.get();
      if (!api.ok) {
        await this.handleError(api.error);
        return;
      }

      const profileResult = await this.deps.profiles.activeProfile();
      if (!profileResult.ok) {
        await this.handleError(profileResult.error);
        return;
      }
      const profile = profileResult.value;
      const config = this.deps.config.read();

      const port = new VscodeGitRepository(repository, new WorkspaceFileReader());
      const selection = this.selectionFor(config, stagedOnly);

      const allowSensitive = this.allowSensitiveNext;
      this.allowSensitiveNext = false;

      const preparedResult = await this.runWithProgress(
        brand('collecting changes'),
        token,
        (report) => {
          report('Collecting changes...');
          return this.deps.service.prepare(
            { port, history: new GitHistorySource(repository) },
            { config, profile, selection, allowSensitive },
            token,
          );
        },
      );
      if (!preparedResult.ok) {
        await this.handleError(preparedResult.error);
        return;
      }
      const prepared = preparedResult.value;

      const url = evaluateUrl(prepared.profile.baseUrl, prepared.profile.provider);
      if (!url.ok) {
        await this.handleError(url.error);
        return;
      }

      const consentRequest: ConsentRequest = {
        origin: url.value.origin,
        providerId: prepared.profile.provider,
        model: prepared.profile.model,
        mode: prepared.mode.id,
        estimatedTokens: prepared.plan.estimatedTokens,
        routedVia: this.routeFor(prepared.profile),
      };

      if (!(await this.deps.consent.isGranted(consentRequest))) {
        const decision = await askConsent(consentRequest);
        if (decision.preview) {
          await showPreview(redactSecrets(`${prepared.system}\n\n${prepared.user}`).text);
          return;
        }
        if (!decision.granted) {
          return;
        }
        await this.deps.consent.record(consentRequest);
      }

      const outcome = await this.runWithProgress(brand('generating commit message'), token, (report) => {
        let lastCompleted = 0;
        report('Preparing prompt...');
        return this.deps.service.execute(prepared, token, (event) => {
          const increment = progressIncrement(lastCompleted, event.completed, event.total);
          lastCompleted = Math.max(lastCompleted, event.completed);
          report(summaryProgressMessage(event), increment > 0 ? increment : undefined);
        });
      });
      if (!outcome.ok) {
        await this.handleError(outcome.error, repository, prepared);
        return;
      }

      await this.writeResult(repository, outcome.value, prepared);
    } finally {
      this.active = undefined;
      this.deps.statusBar.setBusy(false);
      await this.setContext(PRODUCT.context.generating, false);
    }
  }

  private async regenerate(): Promise<void> {
    if (this.active) {
      void vscode.window.showInformationMessage(brand('Already generating a message.'));
      return;
    }
    const last = this.last;
    if (!last) {
      void vscode.window.showInformationMessage('There is no previous generation to repeat.');
      return;
    }
    const api = await this.deps.gitApi.get();
    if (!api.ok) {
      await this.handleError(api.error);
      return;
    }
    const repository = new RepositoryResolver(api.value).byRootPath(last.repoRoot);
    if (!repository) {
      await this.handleError({
        code: 'no_repository',
        message: 'The repository used for the previous generation is no longer open.',
        retryable: false,
      });
      return;
    }

    const token = new CancelToken();
    this.active = token;
    this.deps.statusBar.setBusy(true);
    await this.setContext(PRODUCT.context.generating, true);
    try {
      const url = evaluateUrl(last.prepared.profile.baseUrl, last.prepared.profile.provider);
      if (!url.ok) {
        await this.handleError(url.error);
        return;
      }
      const consentRequest: ConsentRequest = {
        origin: url.value.origin,
        providerId: last.prepared.profile.provider,
        model: last.prepared.profile.model,
        mode: last.prepared.mode.id,
        estimatedTokens: last.prepared.plan.estimatedTokens,
        routedVia: this.routeFor(last.prepared.profile),
      };
      if (!(await this.deps.consent.isGranted(consentRequest))) {
        const decision = await askConsent(consentRequest);
        if (!decision.granted) {
          return;
        }
        await this.deps.consent.record(consentRequest);
      }

      const outcome = await this.runWithProgress(brand('regenerating commit message'), token, (report) => {
        let lastCompleted = 0;
        report('Preparing prompt...');
        return this.deps.service.execute(last.prepared, token, (event) => {
          const increment = progressIncrement(lastCompleted, event.completed, event.total);
          lastCompleted = Math.max(lastCompleted, event.completed);
          report(summaryProgressMessage(event), increment > 0 ? increment : undefined);
        });
      });
      if (!outcome.ok) {
        await this.handleError(outcome.error, repository, last.prepared);
        return;
      }
      await this.writeResult(repository, outcome.value, last.prepared);
    } finally {
      this.active = undefined;
      this.deps.statusBar.setBusy(false);
      await this.setContext(PRODUCT.context.generating, false);
    }
  }

  private async preview(): Promise<void> {
    const api = await this.deps.gitApi.get();
    if (!api.ok) {
      await this.handleError(api.error);
      return;
    }
    const repository = await this.resolveRepository();
    if (!repository) {
      return;
    }
    const profileResult = await this.deps.profiles.activeProfile();
    if (!profileResult.ok) {
      await this.handleError(profileResult.error);
      return;
    }
    const config = this.deps.config.read();
    const port = new VscodeGitRepository(repository, new WorkspaceFileReader());
    const selection = this.selectionFor(config, false);
    const token = new CancelToken();
    this.active = token;
    try {
      const prepared = await this.runWithProgress(brand('building payload'), token, (report) => {
        report('Collecting changes...');
        return this.deps.service.prepare(
          { port, history: new GitHistorySource(repository) },
          { config, profile: profileResult.value, selection, allowSensitive: false },
          token,
        );
      });
      if (!prepared.ok) {
        await this.handleError(prepared.error);
        return;
      }
      await showPreview(redactSecrets(`${prepared.value.system}\n\n${prepared.value.user}`).text);
    } finally {
      this.active = undefined;
    }
  }

  private cancel(): void {
    if (!this.active) {
      return;
    }
    this.active.abort('user');
    void vscode.window.showInformationMessage(brand('generation cancelled.'));
  }

  private async editMessage(): Promise<void> {
    await vscode.commands.executeCommand('workbench.view.scm');
    const focused = await this.focusScmInputIfAvailable();

    if (!this.last) {
      void vscode.window.showInformationMessage(
        brand('generate a message first; it will appear in the Source Control input box for editing.'),
      );
      return;
    }

    void vscode.window.showInformationMessage(
      focused
        ? brand('edit the generated message in the Source Control input box, then commit when ready.')
        : brand('the generated message is in the Source Control input box. Edit it there, then commit when ready.'),
    );
  }

  private async focusScmInputIfAvailable(): Promise<boolean> {
    // The public API has no input-box focus command; probe known workbench ids.
    const candidates = ['workbench.scm.focusInput', 'workbench.action.scm.focusInput'];
    try {
      const available = await vscode.commands.getCommands(true);
      for (const id of candidates) {
        if (available.includes(id)) {
          await vscode.commands.executeCommand(id);
          return true;
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  private async undo(): Promise<void> {
    const last = this.last;
    if (!last) {
      void vscode.window.showInformationMessage('There is no generated message to undo.');
      return;
    }
    const api = await this.deps.gitApi.get();
    if (!api.ok) {
      await this.handleError(api.error);
      return;
    }
    const repository = new RepositoryResolver(api.value).byRootPath(last.repoRoot);
    if (!repository) {
      await this.handleError({
        code: 'no_repository',
        message: 'The repository used for the previous generation is no longer open.',
        retryable: false,
      });
      return;
    }
    await new ScmMessageWriter(repository).restore(last.previous);
    this.last = undefined;
    await this.setContext(PRODUCT.context.hasLastResult, false);
    void vscode.window.showInformationMessage(brand('previous commit message restored.'));
  }

  private async writeResult(
    repository: GitRepository,
    outcome: GenerationOutcome,
    prepared: PreparedGeneration,
  ): Promise<void> {
    const writer = new ScmMessageWriter(repository);
    const current = writer.readCurrent();
    const config = this.deps.config.read();

    let policy: WritePolicy = 'replace';
    if (current.trim().length > 0) {
      if (config.output.overwriteDraft === 'append') {
        policy = 'append';
      } else if (config.output.overwriteDraft === 'ask') {
        const decision = await askDraftPolicy(current);
        if (decision === 'cancel') {
          return;
        }
        policy = decision;
      }
    }

    const written = await writer.write(outcome.message.raw, policy);
    this.last = { repoRoot: repository.rootUri.fsPath, previous: written.previous, outcome, prepared };
    await this.setContext(PRODUCT.context.hasLastResult, true);

    const parts = [
      `${prepared.changeSet.counts.files} files`,
      prepared.mode.id,
      `~${prepared.plan.estimatedTokens} tokens`,
      `${outcome.durationMs}ms`,
    ];
    if (prepared.plan.omitted.length > 0) {
      parts.push(`${prepared.plan.omitted.length} omitted`);
    }
    if (outcome.message.warnings.length > 0) {
      parts.push(`${outcome.message.warnings.length} warning(s)`);
    }
    const limitations = outcome.summary?.limitations ?? [];
    if (limitations.length > 0) {
      parts.push(`${limitations.length} limitation(s)`);
    }

    this.deps.logger.info('commit message generated', {
      files: prepared.changeSet.counts.files,
      mode: prepared.mode.id,
      strategy: prepared.plan.strategy,
      tokens: prepared.plan.estimatedTokens,
      durationMs: outcome.durationMs,
      warnings: outcome.message.warnings.length,
      limitations: limitations.length,
    });

    if (outcome.message.warnings.length > 0) {
      this.deps.output.appendLine('Warnings:');
      for (const warning of outcome.message.warnings) {
        this.deps.output.appendLine(`  - ${warning}`);
      }
    }
    if (limitations.length > 0) {
      this.deps.output.appendLine('Limitations:');
      for (const limitation of limitations) {
        this.deps.output.appendLine(`  - ${limitation}`);
      }
    }

    const actions = ['Undo', 'Regenerate', 'Copy'];
    if (limitations.length > 0) {
      actions.push('Details');
    }
    const choice = await vscode.window.showInformationMessage(
      brand(`message written to Source Control | ${parts.join(' | ')}`),
      ...actions,
    );
    if (choice === 'Details') {
      this.deps.output.show();
      return;
    }
    if (choice === 'Undo') {
      await this.undo();
    } else if (choice === 'Regenerate') {
      await this.regenerate();
    } else if (choice === 'Copy') {
      await vscode.env.clipboard.writeText(outcome.message.raw);
    }
  }

  private async resolveRepository(): Promise<GitRepository | undefined> {
    const api = await this.deps.gitApi.get();
    if (!api.ok) {
      await this.handleError(api.error);
      return undefined;
    }
    const resolver = new RepositoryResolver(api.value);
    const resolved = resolver.resolve();
    if (resolved) {
      return resolved;
    }
    const choices = resolver.choices();
    if (choices.length === 0) {
      const initialized = await this.offerInitialize(api.value);
      if (initialized) {
        return initialized;
      }
      await this.handleError({
        code: 'no_repository',
        message: 'No Git repository is open in this workspace.',
        retryable: false,
      });
      return undefined;
    }
    if (choices.length === 1) {
      return choices[0].repository;
    }
    const picked = await pickRepository(choices);
    return picked?.repository;
  }

  private async handleError(
    error: AppError,
    repository?: GitRepository,
    prepared?: PreparedGeneration,
  ): Promise<void> {
    this.deps.logger.error('generation failed', { code: error.code, httpStatus: error.httpStatus });

    switch (error.code) {
      case 'cancelled':
        return;
      case 'no_changes':
        void vscode.window.showInformationMessage(error.message);
        return;
      case 'secret_missing':
      case 'auth': {
        const choice = await vscode.window.showErrorMessage(this.describeError(error), 'Set API Key');
        if (choice === 'Set API Key') {
          await this.deps.settings.setApiKey();
        }
        return;
      }
      case 'profile_missing':
      case 'profile_invalid':
      case 'url_rejected': {
        const choice = await vscode.window.showErrorMessage(
          this.describeError(error),
          'Manage Profiles',
          'Open Settings',
        );
        if (choice === 'Manage Profiles') {
          await this.deps.settings.openHub();
        } else if (choice === 'Open Settings') {
          await this.openSettings();
        }
        return;
      }
      case 'context_overflow': {
        const choice = await vscode.window.showErrorMessage(
          this.describeError(error),
          'Switch to Smart Mode',
          'Use Local Fallback',
          'Show Log',
        );
        if (choice === 'Switch to Smart Mode') {
          await vscode.workspace
            .getConfiguration(PRODUCT.configSection)
            .update('mode', 'smart', vscode.ConfigurationTarget.Workspace);
          await this.generate();
        } else if (choice === 'Use Local Fallback') {
          await this.offerFallback(error, repository, prepared);
        } else if (choice === 'Show Log') {
          this.deps.output.show();
        }
        return;
      }
      case 'invalid_response': {
        await this.offerFallback(error, repository, prepared);
        return;
      }
      default: {
        await this.offerFallback(error, repository, prepared);
      }
    }
  }

  private describeError(error: AppError): string {
    if (!error.providerId || error.message.includes(error.providerId)) {
      return error.message;
    }
    const model = error.model ? `/${error.model}` : '';
    return `${error.message} (${error.providerId}${model})`;
  }

  private async offerFallback(
    error: AppError,
    repository?: GitRepository,
    prepared?: PreparedGeneration,
  ): Promise<boolean> {
    if (!repository || !prepared) {
      const choice = await vscode.window.showErrorMessage(this.describeError(error), 'Show Log');
      if (choice === 'Show Log') {
        this.deps.output.show();
      }
      return false;
    }

    const choice = await vscode.window.showErrorMessage(
      `${this.describeError(error)} Use a message generated locally from the file list instead?`,
      'Use Local Fallback',
      'Show Log',
    );
    if (choice === 'Use Local Fallback') {
      await this.writeFallback(repository, prepared);
      return true;
    }
    if (choice === 'Show Log') {
      this.deps.output.show();
    }
    return false;
  }

  private async writeFallback(repository: GitRepository, prepared: PreparedGeneration): Promise<void> {
    const fallback = heuristicMessage(prepared.plan, prepared.mode.id);
    const writer = new ScmMessageWriter(repository);
    const written = await writer.write(fallback.raw, 'replace');
    this.last = {
      repoRoot: repository.rootUri.fsPath,
      previous: written.previous,
      outcome: {
        message: fallback,
        prepared,
        durationMs: 0,
        payloadPreview: '',
      },
      prepared,
    };
    await this.setContext(PRODUCT.context.hasLastResult, true);
    void vscode.window.showInformationMessage(
      brand('local fallback message written from the changed file list.'),
      'Undo',
      'Regenerate',
    );
  }

  private async offerInitialize(api: GitAPI): Promise<GitRepository | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length !== 1) {
      return undefined;
    }
    const choice = await vscode.window.showWarningMessage(
      `"${folders[0].name}" is not a Git repository. Initialize it now?`,
      { modal: true },
      'Initialize Repository',
    );
    if (choice !== 'Initialize Repository') {
      return undefined;
    }
    try {
      const repository = await api.init(folders[0].uri);
      if (repository) {
        void vscode.window.showInformationMessage(brand('Git repository initialized.'));
      }
      return repository ?? undefined;
    } catch {
      return undefined;
    }
  }

  private async selectRepository(): Promise<void> {
    const api = await this.deps.gitApi.get();
    if (!api.ok) {
      await this.handleError(api.error);
      return;
    }
    const resolver = new RepositoryResolver(api.value);
    const picked = await pickRepository(resolver.choices());
    if (!picked) {
      return;
    }
    await vscode.commands.executeCommand('workbench.view.scm');
  }

  private async useProfile(profileId?: string): Promise<void> {
    if (!profileId) {
      await this.deps.settings.selectProvider();
      return;
    }
    const selected = await this.deps.profiles.select(profileId);
    if (!selected.ok) {
      await this.handleError(selected.error);
      return;
    }
    await this.refreshStatusBar();
    void vscode.window.showInformationMessage(
      brand(`active provider is "${selected.value.label}".`),
    );
  }

  private async toggleSetting(key: unknown): Promise<void> {
    if (!isToggleKey(key)) {
      return;
    }
    const labels: Record<ToggleKey, string> = {
      'context.includeStaged': 'Staged changes',
      'context.includeUnstaged': 'Unstaged changes',
      'context.includeUntracked': 'Untracked files',
      'conventional.enabled': 'Conventional Commits',
      'privacy.localOnly': 'Local-only mode',
    };
    const config = vscode.workspace.getConfiguration(PRODUCT.configSection);
    const next = !config.get<boolean>(key, false);
    await config.update(key, next, vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage(
      brand(`${labels[key]} ${next ? 'enabled' : 'disabled'}.`),
    );
  }

  private async selectModel(): Promise<void> {
    const profileResult = await this.deps.profiles.activeProfile();
    if (!profileResult.ok) {
      await this.handleError(profileResult.error);
      return;
    }
    const profile = profileResult.value;
    const effective = resolveEffectiveProfile(profile, {
      localOnly: this.deps.config.read().privacy.localOnly,
    });
    if (!effective.ok) {
      await this.handleError(effective.error);
      return;
    }

    const token = new CancelToken();
    const result = await this.runWithProgress(brand('loading models'), token, () =>
      this.deps.models.list(effective.value, this.deps.registry.get(effective.value), token, this.deps.clock.now()),
    );

    let model = '';
    if (result.ok && result.value.length > 0) {
      const items = result.value.map((entry) => ({
        label: entry.id,
        description: entry.contextWindow ? `${entry.contextWindow} token context` : undefined,
        model: entry.id,
      }));
      items.unshift({ label: '$(edit) Enter a model id manually', description: profile.model, model: '' });
      const picked = await vscode.window.showQuickPick(items, {
        title: `Model for ${profile.label}`,
        placeHolder: profile.model,
        matchOnDescription: true,
      });
      if (!picked) {
        return;
      }
      model = picked.model;
    } else if (!result.ok) {
      this.deps.logger.warn('model listing failed', { code: result.error.code });
    }

    if (model.length === 0) {
      const input = await vscode.window.showInputBox({
        title: `Model id for ${profile.label}`,
        value: profile.model,
        ignoreFocusOut: true,
      });
      if (!input || input.trim().length === 0) {
        return;
      }
      model = input.trim();
    }

    const updated = await this.deps.profiles.updateModel(profile.id, model);
    if (!updated.ok) {
      await this.handleError(updated.error);
      return;
    }
    this.deps.models.invalidate(profile.id);
    await this.refreshStatusBar();
    void vscode.window.showInformationMessage(
      brand(`model for "${profile.label}" is now "${updated.value.model}".`),
    );
  }

  private async allowSensitiveOnce(): Promise<void> {
    this.allowSensitiveNext = true;
    void vscode.window.showWarningMessage(
      brand('sensitive files will be included in the NEXT generation only. Secrets are still redacted.'),
    );
  }

  private async revokeConsent(): Promise<void> {
    const confirmed = await confirm(`Revoke all ${PRODUCT.displayName} egress consent records?`, 'Revoke');
    if (!confirmed) {
      return;
    }
    await this.deps.consent.revokeAll();
    void vscode.window.showInformationMessage(brand('egress consent revoked.'));
  }

  private async showDiagnostics(): Promise<void> {
    const api = await this.deps.gitApi.get();
    const profiles = await this.deps.profiles.list();
    const grants = await this.deps.consent.list();
    const lines = [
      `${PRODUCT.displayName} diagnostics`,
      `VS Code: ${vscode.version}`,
      `Extension host: ${process.platform} ${process.arch}`,
      `Git API: ${api.ok ? `ready (${api.value.repositories.length} repositories)` : `unavailable (${api.error.code})`}`,
      `Profiles: ${profiles.length}`,
      `Active profile: ${vscode.workspace.getConfiguration(PRODUCT.configSection).get<string>('activeProfileId', '(auto)')}`,
      `Egress consent records: ${grants.length}`,
      `Mode: ${vscode.workspace.getConfiguration(PRODUCT.configSection).get<string>('mode', 'smart')}`,
    ];
    this.deps.output.appendLine(lines.join('\n'));
    await showPreview(lines.join('\n'));
  }

  private async openSettings(): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.openSettings', PRODUCT.configSection);
  }

  private routeFor(profile: ProviderProfile): ConsentRequest['routedVia'] {
    if (profile.provider !== 'opencode') {
      return undefined;
    }
    const index = profile.model.indexOf('/');
    if (index <= 0) {
      return undefined;
    }
    return { providerId: profile.model.slice(0, index), modelId: profile.model.slice(index + 1) };
  }

  private async runWithProgress<T>(
    title: string,
    token: CancelToken,
    work: (report: (message: string, increment?: number) => void) => Promise<T>,
  ): Promise<T> {
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: true },
      async (progress, cancellation) => {
        const subscription = cancellation.onCancellationRequested(() => token.abort('user'));
        try {
          return await work((message, increment) => progress.report({ message, increment }));
        } finally {
          subscription.dispose();
        }
      },
    );
  }

  private async setContext(key: string, value: boolean): Promise<void> {
    await vscode.commands.executeCommand('setContext', key, value);
  }
}



