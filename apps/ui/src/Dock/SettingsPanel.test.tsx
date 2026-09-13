import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConfigResponse, HealthResponse } from "@/Controls/Adapter/adapterClient";
import type { useAdapterConfig } from "@/Controls/Adapter/useAdapterConfig";
import { DEFAULT_START_OPTIONS } from "@/data/constants";
import SettingsPanel, { type SettingsPanelProps } from "./SettingsPanel";

// The Advanced leaf's only dependency is the debounced options hook; it needs
// the data provider otherwise, which says nothing about which body the tab
// selects.
vi.mock("@/hooks/useOptions", () => ({
  useOptions: () => ({ options: DEFAULT_START_OPTIONS, updateOption: vi.fn() }),
}));

const health: HealthResponse = {
  source: { type: "simulator", healthy: true },
  sinks: [
    { type: "kafka", healthy: true },
    { type: "webhook", healthy: true },
  ],
  availableSources: [],
  availableSinks: [],
};

const config: ConfigResponse = {
  activeSource: "simulator",
  activeSinks: ["kafka", "webhook"],
  sourceConfig: {},
  sinkConfig: {},
  status: health,
  realism: {
    config: {},
    schema: [],
    status: {
      enabled: true,
      devices: 4,
      connected: 3,
      degraded: 1,
      disconnected: 0,
      buffered: 2,
    },
  },
};

function adapter(
  overrides: Partial<ReturnType<typeof useAdapterConfig>> = {}
): ReturnType<typeof useAdapterConfig> {
  return {
    health,
    config,
    loading: false,
    error: null,
    setSource: vi.fn(),
    addSink: vi.fn(),
    removeSink: vi.fn(),
    setRealism: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useAdapterConfig>;
}

function props(overrides: Partial<SettingsPanelProps> = {}): SettingsPanelProps {
  return {
    tab: "source",
    advanced: { maxSpeedRef: { current: 50 } },
    feeds: { adapter: adapter() },
    ...overrides,
  };
}

describe("SettingsPanel", () => {
  it("renders the Source body for the Source tab", () => {
    render(<SettingsPanel {...props({ tab: "source" })} />);

    expect(screen.getByLabelText("Source Type")).toBeInTheDocument();
    expect(screen.getByText("simulator")).toBeInTheDocument();
  });

  it("renders the Sinks body, with the active count in its heading", () => {
    render(<SettingsPanel {...props({ tab: "sinks" })} />);

    const heading = screen.getByText("Active sinks").parentElement as HTMLElement;
    expect(heading).toHaveTextContent("2");
    expect(screen.getByText("kafka")).toBeInTheDocument();
    expect(screen.getByText("webhook")).toBeInTheDocument();
  });

  it("renders the Realism body for the Realism tab", () => {
    render(<SettingsPanel {...props({ tab: "realism" })} />);

    expect(screen.getByText("Device realism")).toBeInTheDocument();
    expect(screen.queryByLabelText("Source Type")).not.toBeInTheDocument();
  });

  it("renders the Advanced tuning body for the Advanced tab", () => {
    render(<SettingsPanel {...props({ tab: "advanced" })} />);

    expect(screen.getByText("Publish Interval")).toBeInTheDocument();
    expect(screen.queryByText("Device realism")).not.toBeInTheDocument();
  });

  it("shows one adapter health line on the feed tabs, and none on Advanced", () => {
    const { rerender } = render(<SettingsPanel {...props({ tab: "source" })} />);
    expect(screen.getByText("Adapter ·")).toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();

    rerender(<SettingsPanel {...props({ tab: "advanced" })} />);
    expect(screen.queryByText("Adapter ·")).not.toBeInTheDocument();
  });

  it("draws no tab strip of its own — the Settings dock owns the buttons", () => {
    // The old "Feeds & sinks" tab opened a second Source/Sinks/Realism strip
    // inside the panel. Those are dock tabs now; nothing nests below them.
    for (const tab of ["source", "sinks", "realism", "advanced"] as const) {
      const { unmount } = render(<SettingsPanel {...props({ tab })} />);
      expect(screen.queryAllByRole("tablist")).toHaveLength(0);
      expect(screen.queryAllByRole("tab")).toHaveLength(0);
      unmount();
    }
  });
});
