/**
 * Thin wrapper around sonner so feature code emits notifications through a
 * single, swappable entry point. The <Toaster/> is mounted once in App.tsx.
 */
import { toast as sonnerToast } from "sonner";

export interface ToastOptions {
  /** Optional inline action button (e.g. "Reload" on the new-version prompt). */
  action?: { label: string; onClick: () => void };
  /** Auto-dismiss delay in ms. `Infinity` keeps the toast until dismissed. */
  duration?: number;
}

/**
 * How long each kind stays up, unless the caller says otherwise.
 *
 * A confirmation only has to be *seen* — it says the thing you just did worked,
 * and you already knew what you did. A failure has to be *read*, and often
 * carries a server message, so it gets half again as long.
 */
const DURATION = { success: 3000, info: 4000, error: 6000 } as const;

export const toast = {
  success: (message: string, options?: ToastOptions) =>
    sonnerToast.success(message, { duration: DURATION.success, ...options }),
  error: (message: string, options?: ToastOptions) =>
    sonnerToast.error(message, { duration: DURATION.error, ...options }),
  info: (message: string, options?: ToastOptions) =>
    sonnerToast.info(message, { duration: DURATION.info, ...options }),
};

/** Coerce an unknown thrown value into a human-readable message. */
export function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}
