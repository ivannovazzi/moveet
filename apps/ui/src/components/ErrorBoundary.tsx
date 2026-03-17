import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";
import styles from "./ErrorBoundary.module.css";

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
  }

  render() {
    if (this.state.hasError) {
      // Custom fallback UI if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI
      return (
        <div className={styles.container}>
          <h1 className={styles.title}>Something went wrong</h1>
          <p className={styles.message}>
            {this.state.error?.message || "An unexpected error occurred"}
          </p>
          <button onClick={() => window.location.reload()} className={styles.reloadButton}>
            Reload Page
          </button>
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
    <div className={styles.sectionFallback} role="alert">
      <p className={styles.sectionTitle}>{section} failed to load</p>
      <p className={styles.sectionHint}>
        Try reloading the page. If the problem persists, check the browser console.
      </p>
    </div>
  );
}

export default ErrorBoundary;
