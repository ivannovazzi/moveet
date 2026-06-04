import { useEffect } from "react";
import type { ToastMessage, ToastType } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

const AUTO_DISMISS_MS = 4000;

const toastToneClasses: Record<ToastType, string> = {
  success: "border-l-status-ok text-status-ok",
  error: "border-l-status-error text-status-error",
  info: "border-l-accent text-accent",
};

interface ToastItemProps {
  toast: ToastMessage;
  onDismiss: (id: number) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      role="alert"
      data-type={toast.type}
      className={cn(
        "pointer-events-auto flex min-w-[260px] max-w-[400px] items-center gap-4",
        "rounded-md border border-l-4 border-border bg-card/90 px-3 py-2 text-sm shadow-lg backdrop-blur",
        toastToneClasses[toast.type]
      )}
    >
      <span className="flex-1 break-words text-foreground">{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="flex-shrink-0 rounded-sm px-1 text-muted-foreground hover:text-foreground"
      >
        &times;
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  removeToast: (id: number) => void;
}

export function ToastContainer({ toasts, removeToast }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={removeToast} />
      ))}
    </div>
  );
}
