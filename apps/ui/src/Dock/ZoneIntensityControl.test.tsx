import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ZoneIntensityControl from "./ZoneIntensityControl";

describe("ZoneIntensityControl", () => {
  it("shows the zone's committed intensity as a percentage", () => {
    render(<ZoneIntensityControl value={0.42} onChange={vi.fn()} />);
    expect(screen.getByRole("slider", { name: /intensity/i })).toHaveAttribute(
      "aria-valuenow",
      "42"
    );
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("reports changes back as a 0–1 intensity", () => {
    const onChange = vi.fn();
    render(<ZoneIntensityControl value={0.5} onChange={onChange} />);
    const slider = screen.getByRole("slider", { name: /intensity/i });
    slider.focus();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(0.51);
  });

  it("echoes the drag locally so the readout doesn't wait on the debounced PATCH", () => {
    render(<ZoneIntensityControl value={0.5} onChange={vi.fn()} />);
    const slider = screen.getByRole("slider", { name: /intensity/i });
    slider.focus();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(screen.getByText("51")).toBeInTheDocument();
  });
});
