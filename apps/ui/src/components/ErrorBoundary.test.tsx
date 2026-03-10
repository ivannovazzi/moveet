import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary";

// Component that throws an error for testing
const ThrowError = () => {
  throw new Error("Test error");
};

const WorkingComponent = () => <div>Working Component</div>;

describe("ErrorBoundary", () => {
  it("should render children when there is no error", () => {
    render(
      <ErrorBoundary>
        <WorkingComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText("Working Component")).toBeInTheDocument();
  });

  it("should render error UI when child component throws", () => {
    // Suppress console.error for this test
    const originalError = console.error;
    console.error = () => {};

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Test error")).toBeInTheDocument();
    expect(screen.getByText("Reload Page")).toBeInTheDocument();

    // Restore console.error
    console.error = originalError;
  });

  it("should render custom fallback when provided", () => {
    // Suppress console.error for this test
    const originalError = console.error;
    console.error = () => {};

    const customFallback = <div>Custom Error UI</div>;

    render(
      <ErrorBoundary fallback={customFallback}>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText("Custom Error UI")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();

    // Restore console.error
    console.error = originalError;
  });
});
