import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";
import { Button } from "@/components/ui/button";
import { persistErrorSnapshot } from "@/utils/errorLog";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Error Boundary component to catch and handle React component errors
 * Prevents the entire app from crashing when a component error occurs
 */
class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error details to console in development
    console.error("Error caught by ErrorBoundary:", error, errorInfo);
    // Persist a snapshot so the crash is inspectable post-mortem
    persistErrorSnapshot(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Custom fallback UI if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center text-foreground">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="text-muted-foreground">
            {this.state.error?.message || "An unexpected error occurred"}
          </p>
          <Button onClick={() => window.location.reload()}>Reload Page</Button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Lightweight fallback UI for individual sections within the app.
 * Displays an inline error message instead of crashing the whole page.
 */
export function SectionErrorFallback({ section }: { section: string }) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center text-muted-foreground"
      role="alert"
    >
      <p className="mb-2 text-base font-semibold text-foreground">{section} failed to load</p>
      <p className="text-sm">
        Try reloading the page. If the problem persists, check the browser console.
      </p>
    </div>
  );
}

export default ErrorBoundary;
