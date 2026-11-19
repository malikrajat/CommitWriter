import * as vscode from 'vscode';

export type FileReadResult =
  | { readonly kind: 'content'; readonly data: Uint8Array }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'unreadable' };

/**
 * Minimal file access used for untracked files, which have no index entry and
 * therefore no Git diff. Virtual file systems are supported through
 * `vscode.workspace.fs`.
 */
export interface FileReader {
  read(absolutePath: string, maxBytes: number): Promise<FileReadResult>;
}

export class WorkspaceFileReader implements FileReader {
  async read(absolutePath: string, maxBytes: number): Promise<FileReadResult> {
    const uri = vscode.Uri.file(absolutePath);
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > maxBytes) {
        return { kind: 'too-large' };
      }
      const data = await vscode.workspace.fs.readFile(uri);
      return { kind: 'content', data };
    } catch {
      return { kind: 'unreadable' };
    }
  }
}
