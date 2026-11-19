import { appError, type AppError } from '../core/domain/errors.js';
import type { CancelSignal } from '../core/domain/cancel-signal.js';
import { err, ok, type Result } from '../core/domain/result.js';
import type { UntrackedDiff } from '../core/ports/i-git.js';
import type { FileReader } from './file-reader.js';

const MAX_LINES = 4000;
const BINARY_PROBE_BYTES = 8000;

function isBinary(data: Uint8Array): boolean {
  const limit = Math.min(data.length, BINARY_PROBE_BYTES);
  for (let index = 0; index < limit; index += 1) {
    if (data[index] === 0) {
      return true;
    }
  }
  return false;
}

function synthesize(path: string, content: string): UntrackedDiff {
  const lines = content.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  const capped = lines.slice(0, MAX_LINES);
  const body = capped.map((line) => `+${line}`).join('\n');
  const text = [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${capped.length} @@`,
    body,
  ].join('\n');
  return { text, binary: false, tooLarge: lines.length > MAX_LINES };
}

/**
 * Untracked files are not in the index, so the Git extension API returns an
 * empty diff for them. We read the file through the workspace file system and
 * synthesize an equivalent "new file" patch. No shell command is executed.
 */
export async function readUntrackedDiff(input: {
  readonly reader: FileReader;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly maxBytes: number;
  readonly signal: CancelSignal;
}): Promise<Result<UntrackedDiff, AppError>> {
  if (input.signal.aborted) {
    return err(appError('cancelled', 'Generation cancelled.'));
  }

  const read = await input.reader.read(input.absolutePath, input.maxBytes);
  if (read.kind === 'too-large') {
    return ok({ text: '', binary: false, tooLarge: true });
  }
  if (read.kind === 'unreadable') {
    return err(appError('write_failed', 'Could not read an untracked file.'));
  }
  if (isBinary(read.data)) {
    return ok({ text: '', binary: true, tooLarge: false });
  }
  if (input.signal.aborted) {
    return err(appError('cancelled', 'Generation cancelled.'));
  }

  const content = Buffer.from(read.data).toString('utf8');
  return ok(synthesize(input.relativePath, content));
}
