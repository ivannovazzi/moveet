import { useEffect } from "react";
import type { ToastMessage } from "@/hooks/useToast";
import cn from "classnames";
import css from "./Toast.module.css";

const AUTO_DISMISS_MS = 4000;

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
    <div className={cn(css.toast, css[toast.type])} role="alert">
      <span className={css.message}>{toast.message}</span>
      <button className={css.close} onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
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
    <div className={css.container}>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={removeToast} />
      ))}
    </div>
  );
}
