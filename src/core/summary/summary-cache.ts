/** FNV-1a 32-bit hash plus length; deterministic and dependency-free. */
export function hashText(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}-${input.length.toString(16)}`;
}

interface CacheEntry {
  readonly value: string;
  readonly at: number;
}

/**
 * Bounded LRU cache with a TTL. Used to avoid re-summarizing an unchanged
 * chunk for the same model and prompt version.
 */
export class SummaryCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly clock: { now(): number },
    private readonly maxEntries: number = 200,
    private readonly ttlMs: number = 30 * 60 * 1000,
  ) {}

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (this.clock.now() - entry.at > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: string): void {
    this.entries.delete(key);
    this.entries.set(key, { value, at: this.clock.now() });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
