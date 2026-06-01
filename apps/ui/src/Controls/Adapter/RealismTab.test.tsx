import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RealismTab from "./RealismTab";
import type { ConfigResponse } from "./adapterClient";

const config = {
  realism: {
    config: { enabled: false, reportingPeriodMs: 5000 },
    schema: [
      { name: "enabled", label: "Enabled", type: "boolean", default: false },
      {
        name: "reportingPeriodMs",
        label: "Reporting period (ms)",
        type: "number",
        default: 5000,
      },
    ],
    status: {
      enabled: false,
      devices: 3,
      connected: 2,
      degraded: 1,
      disconnected: 0,
      buffered: 5,
    },
  },
} as unknown as ConfigResponse;

describe("RealismTab", () => {
  it("renders the status strip counts", () => {
    render(<RealismTab config={config} loading={false} onSetRealism={vi.fn()} />);
    // Exact match: "connected" alone (avoids matching "disconnected").
    expect(screen.getByText("connected")).toBeInTheDocument();
    expect(screen.getByText("buffered")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument(); // buffered count
  });

  it("submits realism config on save", () => {
    const onSetRealism = vi.fn();
    render(<RealismTab config={config} loading={false} onSetRealism={onSetRealism} />);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSetRealism).toHaveBeenCalled();
  });
});
