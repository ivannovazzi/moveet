import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Attribution from "./Attribution";

describe("Attribution", () => {
  it("credits OpenStreetMap contributors and links to the copyright page", () => {
    render(<Attribution />);
    const link = screen.getByRole("link", { name: "OpenStreetMap" });
    expect(link).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByTestId("map-attribution")).toHaveTextContent("© OpenStreetMap contributors");
  });

  it("lists additional credits", () => {
    render(
      <Attribution
        credits={[
          { id: "osm", label: "OpenStreetMap", href: "https://example.org/a" },
          { id: "b", label: "Buildings Co", href: "https://example.org/b" },
        ]}
      />
    );
    expect(screen.getByRole("link", { name: "Buildings Co" })).toHaveAttribute(
      "href",
      "https://example.org/b"
    );
  });
});
