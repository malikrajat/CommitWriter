import * as vscode from 'vscode';
import { systemClock } from './core/ports/i-clock.js';
import { ConfigService } from './config/config-service.js';
import { ConsentService } from './config/consent-service.js';
import { ProfileService } from './config/profile-service.js';
import { GitApiProvider } from './git/git-api-provider.js';
import { RedactingLogger } from './logging/redacting-logger.js';
import { AuthResolver } from './providers/auth-resolver.js';
import { FetchHttpClient } from './providers/http/fetch-http-client.js';
import { RedactingHttpClient } from './providers/http/redacting-http-client.js';
import { ProviderRegistry } from './providers/registry.js';
import { ModelCatalog } from './providers/model-catalog.js';
import { SecretStore } from './secrets/secret-store.js';
import { StatusBar } from './ui/status-bar.js';
import { createOutputChannel } from './ui/output-channel.js';
import { SettingsWebviewProvider, VIEW_ID as SETTINGS_VIEW_ID } from './ui/settings-webview.js';import { CommandHost } from './commands/command-host.js';
import { GenerateCommitMessageService } from './commands/generate-commit-message.service.js';
import { SettingsController } from './config/settings-controller.js';
import { SummaryCache } from './core/summary/summary-cache.js';

export interface Container {
  readonly host: CommandHost;
  dispose(): void;
}

export function createContainer(context: vscode.ExtensionContext): Container {
  const clock = systemClock;
  const config = new ConfigService();
  const output = createOutputChannel();
  const logger = new RedactingLogger(output, () => config.read().logLevel);

  const secrets = new SecretStore(context.secrets, clock);
  const auth = new AuthResolver(secrets);
  const http = new RedactingHttpClient(new FetchHttpClient());
  const registry = new ProviderRegistry(http, auth);
  const profiles = new ProfileService(logger);
  const consent = new ConsentService(context.globalState, clock);
  const gitApi = new GitApiProvider(logger);
  const models = new ModelCatalog();
  const service = new GenerateCommitMessageService({ config, registry, logger, clock, summaryCache: new SummaryCache(clock) });
  const statusBar = new StatusBar(config.read().statusBarEnabled);
  const settings = new SettingsController({ profiles, secrets, registry, config, clock, logger });
  const settingsView = new SettingsWebviewProvider(
    { config, profiles },
    context.extension.packageJSON.version ?? '1.0.0',
  );
  const settingsViewRegistration = vscode.window.registerWebviewViewProvider(
    SETTINGS_VIEW_ID,
    settingsView,
    { webviewOptions: { retainContextWhenHidden: true } },
  );
  const settingsViewConfig = config.onDidChange(() => settingsView.refresh());
  const host = new CommandHost({
    config,
    profiles,
    consent,
    secrets,
    logger,
    clock,
    gitApi,
    registry,
    models,
    service,
    statusBar,
    settings,
    output,
  });

  let disposed = false;
  return {
    host,
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      host.dispose();
      settingsViewConfig.dispose();
      settingsViewRegistration.dispose();
      output.dispose();
    },
  };
}
