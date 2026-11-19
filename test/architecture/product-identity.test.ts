import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRODUCT } from '../../src/core/product.js';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

async function walk(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

interface Manifest {
  name: string;
  displayName: string;
  publisher: string;
  contributes: {
    commands: Array<{ command: string }>;
    menus: Record<string, Array<{ command?: string }>>;
    configuration: { properties: Record<string, unknown> };
    viewsContainers?: { activitybar?: Array<{ id: string; icon: string }> };
    views?: Record<string, Array<{ id: string; icon?: string }>>;
  };
}

async function manifest(): Promise<Manifest> {
  return JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8')) as Manifest;
}

describe('product identity', () => {
  it('keeps the placeholder name consistent with the manifest', async () => {
    const pkg = await manifest();
    expect(pkg.name).toBe(PRODUCT.id);
    expect(pkg.displayName).toBe(PRODUCT.displayName);
    expect(pkg.publisher).toBe(PRODUCT.publisher);
    expect(PRODUCT.placeholder).toBe(true);
  });

  it('declares exactly the commands registered in code', async () => {
    const pkg = await manifest();
    const declared = pkg.contributes.commands.map((entry) => entry.command).sort();
    const fromProduct = Object.values(PRODUCT.command).sort();
    expect(declared).toEqual(fromProduct);
  });

  it('prefixes every contributed command and setting', async () => {
    const pkg = await manifest();
    const prefix = `${PRODUCT.id}.`;
    for (const command of pkg.contributes.commands) {
      expect(command.command.startsWith(prefix), command.command).toBe(true);
    }
    for (const key of Object.keys(pkg.contributes.configuration.properties)) {
      expect(key.startsWith(prefix), key).toBe(true);
    }
  });

  it('only references declared commands from menus', async () => {
    const pkg = await manifest();
    const declared = new Set(pkg.contributes.commands.map((entry) => entry.command));
    for (const [menu, entries] of Object.entries(pkg.contributes.menus)) {
      for (const entry of entries) {
        if (entry.command) {
          expect(declared.has(entry.command), `${menu}: ${entry.command}`).toBe(true);
        }
      }
    }
  });

  it('registers the sidebar under the product id', async () => {
    const pkg = await manifest();
    const container = pkg.contributes.viewsContainers?.activitybar?.[0];
    expect(container?.id).toBe(PRODUCT.id);
    expect(container?.icon).toBe('media/activity-icon.svg');

    const views = pkg.contributes.views?.[PRODUCT.id] ?? [];
    expect(views).toHaveLength(1);
    expect(views[0]?.id).toBe(`${PRODUCT.id}.settings`);
  });

  it('keeps the brand literal inside product.ts only', async () => {
    const files = await walk(SRC);
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(path.join('core', 'product.ts'))) {
        continue;
      }
      const source = await fs.readFile(file, 'utf8');
      const idPattern = new RegExp(`\\b${PRODUCT.id}\\b`);
      if (source.includes(PRODUCT.displayName) || idPattern.test(source)) {
        offenders.push(path.relative(ROOT, file).replace(/\\/g, '/'));
      }
    }
    expect(offenders).toEqual([]);
  });
});
