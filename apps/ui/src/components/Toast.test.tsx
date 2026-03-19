import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "@testing-library/react";
import { ToastContainer } from "./Toast";
import type { ToastMessage } from "@/hooks/useToast";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function createToast(overrides: Partial<ToastMessage> = {}): ToastMessage {
  return {
    id: 1,
    message: "Test message",
    type: "info",
    ...overrides,
  };
}

describe("ToastContainer", () => {
  it("renders nothing when toasts array is empty", () => {
    const { container } = render(
      <ToastContainer toasts={[]} removeToast={vi.fn()} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders toast items for each toast in array", () => {
    const toasts: ToastMessage[] = [
      createToast({ id: 1, message: "First" }),
      createToast({ id: 2, message: "Second" }),
      createToast({ id: 3, message: "Third" }),
    ];

    render(<ToastContainer toasts={toasts} removeToast={vi.fn()} />);

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(3);
  });

  it("shows correct message text", () => {
    const toasts = [createToast({ message: "Something happened" })];

    render(<ToastContainer toasts={toasts} removeToast={vi.fn()} />);

    expect(screen.getByText("Something happened")).toBeInTheDocument();
  });

  it("shows close button that calls onDismiss", async () => {
    const removeToast = vi.fn();
    const toasts = [createToast({ id: 42 })];

    render(<ToastContainer toasts={toasts} removeToast={removeToast} />);

    const closeButton = screen.getByRole("button", { name: "Dismiss" });
    expect(closeButton).toBeInTheDocument();

    // Use real timers briefly for userEvent click
    vi.useRealTimers();
    await userEvent.click(closeButton);
    vi.useFakeTimers();

    expect(removeToast).toHaveBeenCalledWith(42);
  });

  it("auto-dismisses after timeout", () => {
    const removeToast = vi.fn();
    const toasts = [createToast({ id: 7 })];

    render(<ToastContainer toasts={toasts} removeToast={removeToast} />);

    expect(removeToast).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(removeToast).toHaveBeenCalledWith(7);
  });

  it("applies correct CSS class for error/success/info types", () => {
    const toasts: ToastMessage[] = [
      createToast({ id: 1, type: "error" }),
      createToast({ id: 2, type: "success" }),
      createToast({ id: 3, type: "info" }),
    ];

    render(<ToastContainer toasts={toasts} removeToast={vi.fn()} />);

    const alerts = screen.getAllByRole("alert");
    // CSS modules mangle class names, but the class should contain the type
    expect(alerts[0].className).toMatch(/error/);
    expect(alerts[1].className).toMatch(/success/);
    expect(alerts[2].className).toMatch(/info/);
  });

  it('has role="alert" for accessibility', () => {
    const toasts = [createToast()];

    render(<ToastContainer toasts={toasts} removeToast={vi.fn()} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
