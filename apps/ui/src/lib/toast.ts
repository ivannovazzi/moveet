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

export const toast = {
  success: (message: string, options?: ToastOptions) => sonnerToast.success(message, options),
  error: (message: string, options?: ToastOptions) => sonnerToast.error(message, options),
  info: (message: string, options?: ToastOptions) => sonnerToast.info(message, options),
};

/** Coerce an unknown thrown value into a human-readable message. */
export function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}
