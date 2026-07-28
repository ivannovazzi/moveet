import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Modifiers } from "@/types";
import { createModifiers } from "@/test/mocks/types";
import { createMemoryLocalStorage } from "@/test/mocks/localStorage";

vi.mock("@/hooks/vehicleStore", () => ({
  vehicleStore: {
    setTrailCapacity: vi.fn(),
    getTrail: vi.fn(() => []),
    clearTrails: vi.fn(),
  },
}));

import TogglesPanel from "../TogglesPanel";

beforeEach(() => {
  vi.stubGlobal("localStorage", createMemoryLocalStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel(modifiers: Partial<Modifiers>, onChange = vi.fn(() => vi.fn())) {
  render(
    <TogglesPanel
      modifiers={{ ...createModifiers(), ...modifiers } as Modifiers}
      onChangeModifiers={onChange}
    />
  );
  return onChange;
}

describe("TogglesPanel — Jobs", () => {
  it("exposes Jobs through the same visibility-toggle list", () => {
    renderPanel({});
    expect(screen.getByLabelText("Jobs")).toBeInTheDocument();
  });

  it("reads as off when showJobs is absent (optional modifier)", () => {
    renderPanel({});
    expect(screen.getByLabelText("Jobs")).not.toBeChecked();
  });

  it("reads as on when showJobs is true", () => {
    renderPanel({ showJobs: true });
    expect(screen.getByLabelText("Jobs")).toBeChecked();
  });

  it("routes changes through onChangeModifiers('showJobs')", () => {
    const setter = vi.fn();
    const onChange = vi.fn(() => setter);
    renderPanel({}, onChange);

    fireEvent.click(screen.getByLabelText("Jobs"));

    expect(onChange).toHaveBeenCalledWith("showJobs");
    expect(setter).toHaveBeenCalledWith(true);
  });
});
