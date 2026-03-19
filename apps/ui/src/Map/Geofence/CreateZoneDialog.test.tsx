import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CreateZoneDialog from "./CreateZoneDialog";

describe("CreateZoneDialog", () => {
  const validPolygon: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];

  const defaultProps = {
    polygon: validPolygon,
    onSubmit: vi.fn(),
    onClose: vi.fn(),
  };

  it("renders nothing when polygon is null", () => {
    const { container } = render(
      <CreateZoneDialog polygon={null} onSubmit={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders the dialog with polygon data", () => {
    render(<CreateZoneDialog {...defaultProps} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create Zone" })).toBeInTheDocument();
    expect(screen.getByText("4 vertices")).toBeInTheDocument();
  });

  it("shows the name input, type select, and color picker", () => {
    render(<CreateZoneDialog {...defaultProps} />);
    expect(screen.getByLabelText(/Name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Type/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Color/)).toBeInTheDocument();
  });

  it("submit button is disabled when name is empty", () => {
    render(<CreateZoneDialog {...defaultProps} />);
    const submitButton = screen.getByRole("button", { name: /Create Zone/i });
    expect(submitButton).toBeDisabled();
  });

  it("does not call onSubmit when name is blank on form submit", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CreateZoneDialog {...defaultProps} onSubmit={onSubmit} />);

    // The name input has required + submit button is disabled, but test the
    // handleSubmit guard: type a space then clear it, then try to submit
    const nameInput = screen.getByLabelText(/Name/);
    await user.type(nameInput, "   ");
    // Even with spaces the button should be disabled since "   ".trim() is empty
    const submitButton = screen.getByRole("button", { name: /Create Zone/i });
    expect(submitButton).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onSubmit with correct payload for a valid non-self-intersecting polygon", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CreateZoneDialog {...defaultProps} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/Name/), "Warehouse Zone");
    await user.click(screen.getByRole("button", { name: /Create Zone/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Warehouse Zone",
      type: "monitoring",
      polygon: validPolygon,
    });
  });

  it("shows self-intersection validation error for a bowtie polygon", async () => {
    const selfIntersectingPolygon: [number, number][] = [
      [0, 0],
      [2, 2],
      [2, 0],
      [0, 2],
    ];
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <CreateZoneDialog polygon={selfIntersectingPolygon} onSubmit={onSubmit} onClose={vi.fn()} />,
    );

    await user.type(screen.getByLabelText(/Name/), "Bad Zone");
    await user.click(screen.getByRole("button", { name: /Create Zone/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Polygon edges must not cross each other.",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows validation error for polygon with fewer than 3 vertices", async () => {
    const twoVertices: [number, number][] = [
      [0, 0],
      [1, 1],
    ];
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <CreateZoneDialog polygon={twoVertices} onSubmit={onSubmit} onClose={vi.fn()} />,
    );

    await user.type(screen.getByLabelText(/Name/), "Tiny Zone");
    await user.click(screen.getByRole("button", { name: /Create Zone/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Polygon must have at least 3 vertices.",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clears validation error on next successful submit", async () => {
    // First render with a self-intersecting polygon to trigger error
    const selfIntersectingPolygon: [number, number][] = [
      [0, 0],
      [2, 2],
      [2, 0],
      [0, 2],
    ];
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <CreateZoneDialog polygon={selfIntersectingPolygon} onSubmit={onSubmit} onClose={vi.fn()} />,
    );

    await user.type(screen.getByLabelText(/Name/), "Test Zone");
    await user.click(screen.getByRole("button", { name: /Create Zone/i }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Re-render with a valid polygon — the error should clear on the next submit
    rerender(
      <CreateZoneDialog polygon={validPolygon} onSubmit={onSubmit} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: /Create Zone/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalled();
  });

  it("includes color in the request when color is set", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CreateZoneDialog {...defaultProps} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/Name/), "Colored Zone");
    // fireEvent for color input (userEvent doesn't support type="color" well)
    const colorInput = screen.getByLabelText(/Color/);
    // Use native input event for color picker
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      colorInput,
      "#ff0000",
    );
    colorInput.dispatchEvent(new Event("input", { bubbles: true }));
    colorInput.dispatchEvent(new Event("change", { bubbles: true }));

    await user.click(screen.getByRole("button", { name: /Create Zone/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Colored Zone",
        color: "#ff0000",
      }),
    );
  });

  it("calls onClose when cancel button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CreateZoneDialog {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when close (×) button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CreateZoneDialog {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: /Close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("allows changing the fence type", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CreateZoneDialog {...defaultProps} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/Name/), "Restricted Area");
    await user.selectOptions(screen.getByLabelText(/Type/), "restricted");
    await user.click(screen.getByRole("button", { name: /Create Zone/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "restricted",
      }),
    );
  });

  it("resets form fields after successful submit", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CreateZoneDialog {...defaultProps} onSubmit={onSubmit} />);

    const nameInput = screen.getByLabelText(/Name/) as HTMLInputElement;
    await user.type(nameInput, "My Zone");
    await user.click(screen.getByRole("button", { name: /Create Zone/i }));

    // After submit, the name should be cleared
    expect(nameInput.value).toBe("");
  });
});
