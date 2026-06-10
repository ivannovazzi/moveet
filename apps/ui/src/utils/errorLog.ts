import type { ErrorInfo } from "react";

/** localStorage key holding recent crash snapshots for post-mortem debugging. */
export const ERROR_LOG_STORAGE_KEY = "moveet:error-log";
/** Maximum number of snapshots kept (newest first). */
export const ERROR_LOG_MAX_ENTRIES = 10;

export interface ErrorSnapshot {
  message: string;
  stack?: string;
  componentStack?: string;
  timestamp: string;
}

/**
 * Persist a bounded log of error snapshots to localStorage so crashes remain
 * inspectable after a reload (`localStorage.getItem("moveet:error-log")`).
 * Storage failures (quota, private mode) are swallowed — logging must never
 * crash the error path itself.
 */
export function persistErrorSnapshot(error: Error, errorInfo?: ErrorInfo): void {
  try {
    const snapshot: ErrorSnapshot = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo?.componentStack ?? undefined,
      timestamp: new Date().toISOString(),
    };
    let existing: ErrorSnapshot[] = [];
    try {
      const raw = localStorage.getItem(ERROR_LOG_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      // corrupt log — start fresh rather than losing the new snapshot
    }
    const entries = [snapshot, ...existing].slice(0, ERROR_LOG_MAX_ENTRIES);
    localStorage.setItem(ERROR_LOG_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore storage/parse errors
  }
}
