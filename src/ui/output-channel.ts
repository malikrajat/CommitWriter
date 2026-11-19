import * as vscode from 'vscode';
import { PRODUCT } from '../core/product.js';

export function createOutputChannel(): vscode.OutputChannel {
  return vscode.window.createOutputChannel(PRODUCT.displayName);
}
