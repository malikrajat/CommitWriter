export interface Disposable {
  dispose(): void;
}

/**
 * Core-owned cancellation primitive. Structurally satisfied by `AbortSignal`,
 * so adapters can pass one directly without core depending on DOM/Node types.
 */
export interface CancelSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
  onAbort(listener: () => void): Disposable;
}

export class CancelToken implements CancelSignal {
  private listeners: Array<() => void> = [];
  private _aborted = false;
  private _reason: unknown;

  get aborted(): boolean {
    return this._aborted;
  }

  get reason(): unknown {
    return this._reason;
  }

  abort(reason?: unknown): void {
    if (this._aborted) {
      return;
    }
    this._aborted = true;
    this._reason = reason;
    const listeners = this.listeners;
    this.listeners = [];
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // listeners must never break cancellation
      }
    }
  }

  onAbort(listener: () => void): Disposable {
    if (this._aborted) {
      listener();
      return { dispose: () => undefined };
    }
    this.listeners.push(listener);
    return {
      dispose: () => {
        const index = this.listeners.indexOf(listener);
        if (index >= 0) {
          this.listeners.splice(index, 1);
        }
      },
    };
  }
}

export const neverCancelled: CancelSignal = {
  aborted: false,
  onAbort: () => ({ dispose: () => undefined }),
};

export function throwIfAborted(signal: CancelSignal): void {
  if (signal.aborted) {
    throw new CancellationError();
  }
}

export class CancellationError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancellationError';
  }
}

export function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AbortSignal).aborted === 'boolean' &&
    typeof (value as AbortSignal).addEventListener === 'function'
  );
}

/** Adapts a platform AbortSignal to the core CancelSignal. */
export function fromAbortSignal(signal: AbortSignal): CancelSignal {
  return {
    get aborted() {
      return signal.aborted;
    },
    get reason() {
      return signal.reason;
    },
    onAbort(listener: () => void): Disposable {
      signal.addEventListener('abort', listener, { once: true });
      return { dispose: () => signal.removeEventListener('abort', listener) };
    },
  };
}
