import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LoadingOverlay from "./LoadingOverlay";

describe("LoadingOverlay", () => {
  it("returns null when visible is false", () => {
    const { container } = render(<LoadingOverlay visible={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders overlay when visible is true", () => {
    render(<LoadingOverlay visible={true} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it('has role="status" and aria-label', () => {
    render(<LoadingOverlay visible={true} />);
    const overlay = screen.getByRole("status");
    expect(overlay).toHaveAttribute("aria-label", "Loading map data");
  });

  it("shows spinner and label text", () => {
    render(<LoadingOverlay visible={true} />);
    expect(screen.getByText("Loading\u2026")).toBeInTheDocument();
  });
});
