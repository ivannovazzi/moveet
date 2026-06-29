import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConnectionStatus from "../ConnectionStatus";
import type { ConnectionStateInfo } from "@/utils/wsClient";

describe("ConnectionStatus", () => {
  it("renders nothing when connected", () => {
    const info: ConnectionStateInfo = { state: "connected", attempt: 0, maxAttempts: 10 };
    const { container } = render(<ConnectionStatus connectionInfo={info} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders reconnecting banner with attempt info", () => {
    const info: ConnectionStateInfo = { state: "reconnecting", attempt: 2, maxAttempts: 10 };
    render(<ConnectionStatus connectionInfo={info} />);

    const banner = screen.getByTestId("connection-status");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("Reconnecting... (attempt 3/10)");
    expect(banner).toHaveAttribute("role", "alert");
  });

  it("renders disconnected banner", () => {
    const info: ConnectionStateInfo = { state: "disconnected", attempt: 10, maxAttempts: 10 };
    render(<ConnectionStatus connectionInfo={info} />);

    const banner = screen.getByTestId("connection-status");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("Disconnected");
    expect(banner).toHaveTextContent("or refresh the page");
    expect(banner).toHaveAttribute("role", "alert");
  });

  it("shows first attempt correctly", () => {
    const info: ConnectionStateInfo = { state: "reconnecting", attempt: 0, maxAttempts: 5 };
    render(<ConnectionStatus connectionInfo={info} />);

    expect(screen.getByTestId("connection-status")).toHaveTextContent(
      "Reconnecting... (attempt 1/5)"
    );
  });

  it("shows last reconnect attempt correctly", () => {
    const info: ConnectionStateInfo = { state: "reconnecting", attempt: 4, maxAttempts: 5 };
    render(<ConnectionStatus connectionInfo={info} />);

    expect(screen.getByTestId("connection-status")).toHaveTextContent(
      "Reconnecting... (attempt 5/5)"
    );
  });

  it("offers a Retry action when disconnected", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const info: ConnectionStateInfo = { state: "disconnected", attempt: 10, maxAttempts: 10 };
    render(<ConnectionStatus connectionInfo={info} onRetry={onRetry} />);

    const button = screen.getByTestId("connection-retry");
    expect(button).toHaveTextContent("Retry");

    await user.click(button);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("does not show Retry while still reconnecting", () => {
    const info: ConnectionStateInfo = { state: "reconnecting", attempt: 2, maxAttempts: 10 };
    render(<ConnectionStatus connectionInfo={info} />);

    expect(screen.queryByTestId("connection-retry")).not.toBeInTheDocument();
  });
});
