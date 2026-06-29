/**
 * Thin wrapper around sonner so feature code emits notifications through a
 * single, swappable entry point. The <Toaster/> is mounted once in App.tsx.
 */
import { toast as sonnerToast } from "sonner";

export const toast = {
  success: (message: string) => sonnerToast.success(message),
  error: (message: string) => sonnerToast.error(message),
  info: (message: string) => sonnerToast.info(message),
};

/** Coerce an unknown thrown value into a human-readable message. */
export function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}
