import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ModeRail from "./ModeRail";
import type { ModeDescriptor } from "./modeDescriptors";

function descriptor(overrides: Partial<ModeDescriptor> = {}): ModeDescriptor {
  return {
    kind: "edit-heatzone",
    label: "Edit zone",
    icon: null,
    tone: "warn",
    status: null,
    actions: [{ label: "Delete zone", run: vi.fn(), enabled: true }],
    primary: { label: "Done", run: vi.fn(), enabled: true },
    exit: vi.fn(),
    exitLabel: "Done",
    busy: false,
    dirty: null,
    locksPan: true,
    ...overrides,
  };
}

describe("ModeRail", () => {
  it("renders the mode's inline control when it has one", () => {
    render(<ModeRail descriptor={descriptor({ control: <span>intensity slot</span> })} />);
    expect(screen.getByText("intensity slot")).toBeInTheDocument();
  });

  it("renders nothing extra when the mode has no control", () => {
    render(<ModeRail descriptor={descriptor()} />);
    expect(screen.queryByText("intensity slot")).not.toBeInTheDocument();
  });

  it("keeps the control ahead of the keys that end the mode", () => {
    render(<ModeRail descriptor={descriptor({ control: <span>intensity slot</span> })} />);
    const rail = screen.getByRole("status");
    const order = Array.from(rail.querySelectorAll("span, button"));
    const control = order.indexOf(screen.getByText("intensity slot"));
    const del = order.indexOf(screen.getByRole("button", { name: /delete zone/i }));
    expect(control).toBeGreaterThanOrEqual(0);
    expect(control).toBeLessThan(del);
  });
});
