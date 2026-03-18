import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, Input, Switch, Range } from "./index";

describe("Button", () => {
  it("renders with children text", () => {
    render(<Button>Click Me</Button>);
    expect(screen.getByRole("button", { name: "Click Me" })).toBeInTheDocument();
  });

  it("calls onClick handler", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Click</Button>);
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not call onClick when disabled", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button onClick={onClick} disabled>
        Click
      </Button>
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Input", () => {
  it("renders with label", () => {
    render(<Input label="Speed:" value={50} onChange={() => {}} />);
    expect(screen.getByText("Speed:")).toBeInTheDocument();
  });

  it("displays the value", () => {
    render(<Input label="Speed:" value={50} onChange={() => {}} />);
    expect(screen.getByDisplayValue("50")).toBeInTheDocument();
  });

  it("defaults to number type", () => {
    render(<Input label="Speed:" value={50} onChange={() => {}} />);
    expect(screen.getByRole("spinbutton")).toBeInTheDocument();
  });

  it("can be overridden to text type", () => {
    render(<Input label="Name:" value="test" onChange={() => {}} type="text" />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("calls onChange on input", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Input label="Name:" value="" onChange={onChange} type="text" />);
    await user.type(screen.getByRole("textbox"), "5");
    expect(onChange).toHaveBeenCalled();
  });

  it("renders without label", () => {
    render(<Input value={10} onChange={() => {}} />);
    expect(screen.getByDisplayValue("10")).toBeInTheDocument();
  });
});

describe("Switch", () => {
  it("renders as switch role", () => {
    render(<Switch isSelected={false} onChange={() => {}} />);
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });

  it("reflects selected state", () => {
    render(<Switch isSelected={true} onChange={() => {}} />);
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("reflects unselected state", () => {
    render(<Switch isSelected={false} onChange={() => {}} />);
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("calls onChange with boolean when clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch isSelected={false} onChange={onChange} />);
    await user.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does not call onChange when disabled", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch isSelected={false} onChange={onChange} isDisabled />);
    await user.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Range", () => {
  it("renders slider with label", () => {
    render(<Range label="Accel:" value={5} min={1} max={10} onChange={() => {}} />);
    expect(screen.getByText("Accel:")).toBeInTheDocument();
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("has correct aria-valuenow", () => {
    render(<Range label="Speed:" value={7} min={0} max={10} onChange={() => {}} />);
    expect(screen.getByRole("slider")).toHaveAttribute("value", "7");
  });

  it("has correct aria-valuemin and aria-valuemax", () => {
    render(<Range label="Speed:" value={5} min={1} max={10} onChange={() => {}} />);
    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("min", "1");
    expect(slider).toHaveAttribute("max", "10");
  });

  it("shows the current value as text", () => {
    render(<Range label="Speed:" value={7} min={0} max={10} onChange={() => {}} />);
    // The range value is displayed as text next to the label
    expect(screen.getByText("7")).toBeInTheDocument();
  });
});
