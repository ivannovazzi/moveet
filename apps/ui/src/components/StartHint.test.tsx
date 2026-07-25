import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StartHint from "./StartHint";

const noop = () => {};

describe("StartHint", () => {
  it("renders while the simulation is idle and ready", () => {
    render(<StartHint running={false} ready onStart={noop} />);
    expect(screen.getByText("Simulation is paused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start simulation" })).toBeInTheDocument();
  });

  it("renders nothing while the simulation is running", () => {
    const { container } = render(<StartHint running ready onStart={noop} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing before the app is ready", () => {
    const { container } = render(<StartHint running={false} ready={false} onStart={noop} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("disappears once the run begins and stays gone when paused again", () => {
    const { container, rerender } = render(<StartHint running={false} ready onStart={noop} />);
    expect(screen.getByText("Simulation is paused")).toBeInTheDocument();

    rerender(<StartHint running ready onStart={noop} />);
    expect(container).toBeEmptyDOMElement();

    // Pausing later must not resurrect the first-run tutorial.
    rerender(<StartHint running={false} ready onStart={noop} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("calls onStart when the start button is pressed", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn().mockResolvedValue(undefined);
    render(<StartHint running={false} ready onStart={onStart} />);

    await user.click(screen.getByRole("button", { name: "Start simulation" }));

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("shows a pending state while starting", async () => {
    const user = userEvent.setup();
    let resolveStart: () => void = noop;
    const onStart = vi.fn(() => new Promise<void>((resolve) => (resolveStart = resolve)));
    render(<StartHint running={false} ready onStart={onStart} />);

    await user.click(screen.getByRole("button", { name: "Start simulation" }));
    expect(await screen.findByText("Starting…")).toBeInTheDocument();

    resolveStart();
    await waitFor(() => expect(screen.getByText("Start simulation")).toBeInTheDocument());
  });

  it("can be dismissed permanently", async () => {
    const user = userEvent.setup();
    const { container } = render(<StartHint running={false} ready onStart={noop} />);

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(container).toBeEmptyDOMElement();
  });
});
