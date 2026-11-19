import type { SummaryProgress } from '../core/summary/summary-types.js';

/** Human-readable progress text for the notification. */
export function summaryProgressMessage(event: SummaryProgress): string {
  if (event.phase === 'summarizing') {
    return `Summarizing ${event.completed}/${event.total} - ${event.label}`;
  }
  return 'Aggregating summaries...';
}

/** Percentage increment based on newly completed work, clamped to [0, 100]. */
export function progressIncrement(previousCompleted: number, completed: number, total: number): number {
  if (total <= 0 || completed <= previousCompleted) {
    return 0;
  }
  const delta = ((completed - previousCompleted) / total) * 100;
  return Math.max(0, Math.min(100, delta));
}
