/**
 * Minimal glob matcher supporting `**`, `*` and `?` over POSIX paths.
 * Pure and deterministic; no dependency on VS Code or minimatch.
 */
export function globToRegExp(glob: string): RegExp {
  let out = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      out += '[^/]';
      continue;
    }
    if ('\\^$.|+()[]{}'.includes(char)) {
      out += `\\${char}`;
      continue;
    }
    out += char;
  }
  return new RegExp(`${out}$`);
}

export function matchesGlob(path: string, glob: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  if (globToRegExp(glob).test(normalized)) {
    return true;
  }
  // A bare directory or file pattern (no leading wildcard) should also match
  // nested occurrences, e.g. "dist/**" or "package-lock.json".
  if (!glob.startsWith('**/') && !glob.startsWith('/') && !glob.startsWith('*')) {
    return globToRegExp(`**/${glob}`).test(normalized);
  }
  return false;
}

export function matchesAny(path: string, globs: readonly string[]): string | undefined {
  for (const glob of globs) {
    if (matchesGlob(path, glob)) {
      return glob;
    }
  }
  return undefined;
}

/**
 * Safety exclusions that can never be removed by configuration: generated
 * artifacts and lockfiles carry no intent and would dominate any budget.
 */
export const PROTECTED_EXCLUDES: readonly string[] = [
  '**/package-lock.json',
  '**/npm-shrinkwrap.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
  '**/Cargo.lock',
  '**/poetry.lock',
  '**/composer.lock',
  '**/Gemfile.lock',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  '**/*.snap',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/vendor/**',
  '**/node_modules/**',
  '**/coverage/**',
];
