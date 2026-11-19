import * as vscode from 'vscode';
import type { GitAPI, GitRepository } from './git-types.js';

export interface RepositoryChoice {
  readonly repository: GitRepository;
  readonly label: string;
  readonly description: string;
  readonly selected: boolean;
}

/**
 * Resolution ladder: active editor -> SCM selection -> sole repository -> picker.
 */
export class RepositoryResolver {
  constructor(private readonly api: GitAPI) {}

  all(): readonly GitRepository[] {
    return this.api.repositories.filter((repository) => repository.kind !== 'submodule');
  }

  fromActiveEditor(): GitRepository | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return undefined;
    }
    const repository = this.api.getRepository(editor.document.uri);
    return repository && repository.kind !== 'submodule' ? repository : undefined;
  }

  selected(): GitRepository | undefined {
    return this.all().find((repository) => repository.ui.selected);
  }

  resolve(): GitRepository | undefined {
    return this.fromActiveEditor() ?? this.selected() ?? (this.all().length === 1 ? this.all()[0] : undefined);
  }

  byRootPath(rootPath: string): GitRepository | undefined {
    return this.all().find((repository) => repository.rootUri.fsPath === rootPath);
  }

  choices(): RepositoryChoice[] {
    return this.all().map((repository) => ({
      repository,
      label: repository.rootUri.fsPath.split(/[\\/]/).pop() ?? repository.rootUri.fsPath,
      description: repository.rootUri.fsPath,
      selected: repository.ui.selected,
    }));
  }
}
