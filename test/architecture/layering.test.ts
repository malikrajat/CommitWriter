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

function relative(file: string): string {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

describe('architecture invariants', () => {
  it('keeps core free of VS Code, Node built-ins and network calls', async () => {
    const files = await walk(path.join(SRC, 'core'));
    expect(files.length).toBeGreaterThan(20);

    for (const file of files) {
      const source = await fs.readFile(file, 'utf8');
      expect(source, relative(file)).not.toMatch(/from ['"]vscode['"]/);
      expect(source, relative(file)).not.toMatch(/from ['"]node:/);
      expect(source, relative(file)).not.toMatch(/require\(/);
      expect(source, relative(file)).not.toMatch(/\bfetch\s*\(/);
      expect(source, relative(file)).not.toMatch(/process\./);
    }
  });

  it('has exactly one fetch call site', async () => {
    const files = await walk(SRC);
    const offenders: string[] = [];
    for (const file of files) {
      const source = await fs.readFile(file, 'utf8');
      if (/\bfetch\s*\(/.test(source) && !relative(file).endsWith('providers/http/fetch-http-client.ts')) {
        offenders.push(relative(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has exactly one commit-message writer', async () => {
    const files = await walk(SRC);
    const offenders: string[] = [];
    for (const file of files) {
      const source = await fs.readFile(file, 'utf8');
      if (/inputBox\.value\s*=/.test(source) && !relative(file).endsWith('git/message-writer.ts')) {
        offenders.push(relative(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never calls a mutating git API', async () => {
    const files = await walk(SRC);
    for (const file of files) {
      const source = await fs.readFile(file, 'utf8');
      expect(source, relative(file)).not.toMatch(/\.commit\s*\(/);
      expect(source, relative(file)).not.toMatch(/\.apply\s*\(/);
      expect(source, relative(file)).not.toMatch(/\.restore\s*\(\s*\[/);
    }
  });

  it('reveals secrets from exactly one module', async () => {
    const files = await walk(SRC);
    const offenders: string[] = [];
    for (const file of files) {
      const source = await fs.readFile(file, 'utf8');
      if (/\.reveal\s*\(/.test(source) && !relative(file).endsWith('providers/auth-resolver.ts')) {
        offenders.push(relative(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never spawns a process or a shell', async () => {
    const files = await walk(SRC);
    for (const file of files) {
      const source = await fs.readFile(file, 'utf8');
      expect(source, relative(file)).not.toMatch(/from ['"]node:child_process['"]/);
      expect(source, relative(file)).not.toMatch(/require\(['"]child_process['"]\)/);
      expect(source, relative(file)).not.toMatch(/shell:\s*true/);
      expect(source, relative(file)).not.toMatch(/(?<!\.)\bexec(Sync)?\s*\(/);
      expect(source, relative(file)).not.toMatch(/\bspawn(Sync)?\s*\(/);
    }
  });

  it('ships with zero runtime dependencies', async () => {
    const raw = await fs.readFile(path.join(ROOT, 'package.json'), 'utf8');
    const manifest = JSON.parse(raw) as { dependencies?: Record<string, string> };
    expect(manifest.dependencies ?? {}).toEqual({});
  });

  it('ships no telemetry in v1', async () => {
    const files = await walk(SRC);
    for (const file of files) {
      const source = await fs.readFile(file, 'utf8');
      expect(source, relative(file)).not.toMatch(
        /sendTelemetryEvent|isTelemetryEnabled|telemetryReporter|@vscode\/extension-telemetry/,
      );
    }
  });

  it('never disables TLS certificate validation', async () => {
    const files = await walk(SRC);
    for (const file of files) {
      const source = await fs.readFile(file, 'utf8');
      expect(source, relative(file)).not.toMatch(/rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED|strictSSL/i);
    }
  });

  it('has no credential setting and no TLS bypass', async () => {
    const raw = await fs.readFile(path.join(ROOT, 'package.json'), 'utf8');
    expect(raw).not.toMatch(/"apiKey"\s*:/);
    expect(raw).not.toMatch(/rejectUnauthorized|strictSSL|NODE_TLS_REJECT_UNAUTHORIZED/);
  });

  it('keeps provider profiles machine-scoped', async () => {
    const raw = await fs.readFile(path.join(ROOT, 'package.json'), 'utf8');
    const manifest = JSON.parse(raw) as {
      contributes: { configuration: { properties: Record<string, { scope?: string }> } };
    };
    expect(manifest.contributes.configuration.properties[`${PRODUCT.id}.profiles`].scope).toBe('machine');
    expect(manifest.contributes.configuration.properties[`${PRODUCT.id}.activeProfileId`].scope).toBe('machine');
  });
});
