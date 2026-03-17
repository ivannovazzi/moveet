import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ErrorBoundary, { SectionErrorFallback } from "./ErrorBoundary";

// Component that throws an error for testing
const ThrowError = ({ message = "Test error" }: { message?: string }) => {
  throw new Error(message);
};

const WorkingComponent = ({ text = "Working Component" }: { text?: string }) => <div>{text}</div>;

describe("ErrorBoundary", () => {
  // Suppress console.error noise from React and ErrorBoundary during expected error tests
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("should render children when there is no error", () => {
    render(
      <ErrorBoundary>
        <WorkingComponent />
      </ErrorBoundary>
    );

    expect(screen.getByText("Working Component")).toBeInTheDocument();
  });

  it("should render error UI when child component throws", () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Test error")).toBeInTheDocument();
    expect(screen.getByText("Reload Page")).toBeInTheDocument();
  });

  it("should render custom fallback when provided", () => {
    const customFallback = <div>Custom Error UI</div>;

    render(
      <ErrorBoundary fallback={customFallback}>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText("Custom Error UI")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("should render SectionErrorFallback with section name", () => {
    render(
      <ErrorBoundary fallback={<SectionErrorFallback section="Map" />}>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText("Map failed to load")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Try reloading the page. If the problem persists, check the browser console."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  describe("independent boundaries", () => {
    it("one section crashing does not affect sibling sections", () => {
      render(
        <div>
          <ErrorBoundary fallback={<SectionErrorFallback section="Map" />}>
            <ThrowError message="Map exploded" />
          </ErrorBoundary>
          <ErrorBoundary fallback={<SectionErrorFallback section="Controls" />}>
            <WorkingComponent text="Controls are fine" />
          </ErrorBoundary>
        </div>
      );

      // Map section shows its error fallback
      expect(screen.getByText("Map failed to load")).toBeInTheDocument();

      // Controls section still renders normally
      expect(screen.getByText("Controls are fine")).toBeInTheDocument();
    });

    it("both sections can independently fail with their own fallbacks", () => {
      render(
        <div>
          <ErrorBoundary fallback={<SectionErrorFallback section="Map" />}>
            <ThrowError message="Map error" />
          </ErrorBoundary>
          <ErrorBoundary fallback={<SectionErrorFallback section="Controls" />}>
            <ThrowError message="Controls error" />
          </ErrorBoundary>
          <ErrorBoundary>
            <WorkingComponent text="Other content OK" />
          </ErrorBoundary>
        </div>
      );

      // Both sections show their respective fallbacks
      expect(screen.getByText("Map failed to load")).toBeInTheDocument();
      expect(screen.getByText("Controls failed to load")).toBeInTheDocument();

      // Unaffected section still works
      expect(screen.getByText("Other content OK")).toBeInTheDocument();
    });
  });
});

describe("SectionErrorFallback", () => {
  it("renders with the provided section name", () => {
    render(<SectionErrorFallback section="Sidebar" />);

    expect(screen.getByText("Sidebar failed to load")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
