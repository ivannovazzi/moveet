import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import HealthBadge from "./HealthBadge";
import { getBadgeStatus } from "./useAdapterConfig";
import type { HealthResponse } from "./adapterClient";

const healthyStatus: HealthResponse = {
  source: { type: "static", healthy: true },
  sinks: [{ type: "console", healthy: true }],
  availableSources: [],
  availableSinks: [],
};

const unhealthyStatus: HealthResponse = {
  source: { type: "graphql", healthy: false },
  sinks: [{ type: "console", healthy: true }],
  availableSources: [],
  availableSinks: [],
};

describe("getBadgeStatus", () => {
  it("returns unreachable when health is null", () => {
    expect(getBadgeStatus(null)).toBe("unreachable");
  });

  it("returns healthy when all plugins healthy", () => {
    expect(getBadgeStatus(healthyStatus)).toBe("healthy");
  });

  it("returns unhealthy when source is unhealthy", () => {
    expect(getBadgeStatus(unhealthyStatus)).toBe("unhealthy");
  });

  it("returns unhealthy when any sink is unhealthy", () => {
    const status: HealthResponse = {
      source: { type: "static", healthy: true },
      sinks: [
        { type: "console", healthy: true },
        { type: "webhook", healthy: false },
      ],
      availableSources: [],
      availableSinks: [],
    };
    expect(getBadgeStatus(status)).toBe("unhealthy");
  });

  it("returns healthy when no source is active", () => {
    const status: HealthResponse = {
      source: null,
      sinks: [],
      availableSources: [],
      availableSinks: [],
    };
    expect(getBadgeStatus(status)).toBe("healthy");
  });
});

describe("HealthBadge", () => {
  it("renders with healthy title", () => {
    render(<HealthBadge status="healthy" />);
    expect(screen.getByTitle("healthy")).toBeInTheDocument();
  });

  it("renders with unhealthy title", () => {
    render(<HealthBadge status="unhealthy" />);
    expect(screen.getByTitle("unhealthy")).toBeInTheDocument();
  });

  it("renders with unreachable title", () => {
    render(<HealthBadge status="unreachable" />);
    expect(screen.getByTitle("unreachable")).toBeInTheDocument();
  });
});
