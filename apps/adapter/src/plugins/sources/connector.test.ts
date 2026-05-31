import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConnectorSource } from "./connector";
import { fleetRoster } from "../fleetRoster";

// ── kafkajs mock (topic bootstrap) ──────────────────────────────────
// The consumer captures the `eachMessage` handler passed to run() so the test
// can feed it decoded fleet messages, then lets the source's idle-window timer
// resolve connect().
let eachMessage:
  | ((args: { topic: string; message: { value: Buffer | null } }) => Promise<void>)
  | null = null;

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockSubscribe = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const mockRun = vi.fn(
  async (opts: {
    eachMessage: (args: { topic: string; message: { value: Buffer | null } }) => Promise<void>;
  }) => {
    eachMessage = opts.eachMessage;
  }
);

vi.mock("kafkajs", () => {
  class MockKafka {
    consumer() {
      return {
        connect: mockConnect,
        subscribe: mockSubscribe,
        run: mockRun,
        stop: mockStop,
        disconnect: mockDisconnect,
      };
    }
  }
  return {
    Kafka: MockKafka,
    logLevel: { NOTHING: 0 },
  };
});

// ── schema-registry mock ────────────────────────────────────────────
// decode() returns whatever JSON was stashed in the message buffer — the test
// encodes its fixtures as JSON so we don't need real AVRO framing.
const mockDecode = vi.fn(async (buf: Buffer) => JSON.parse(buf.toString("utf8")));

vi.mock("@kafkajs/confluent-schema-registry", () => {
  class MockSchemaRegistry {
    decode = mockDecode;
  }
  return { SchemaRegistry: MockSchemaRegistry, SchemaType: { AVRO: "AVRO" } };
});

const VEHICLE_TOPIC = "trajectory.fleet.vehicle";
const ASSIGNMENT_TOPIC = "trajectory.fleet.assignment";
const ROSTER_URL = "http://connector.test/api/fleet/roster";

// ── REST pull API (default bootstrap) ───────────────────────────────

interface RosterVehicle {
  vehicleId: string;
  plate?: string | null;
  kind?: string | null;
  callsign?: string | null;
}
interface RosterAssignment {
  deviceId: string;
  vehicleId: string;
  source: "fitted_gps" | "shift";
  effectiveFrom?: string;
}

/** Build a mocked global.fetch that returns the given roster JSON once. */
function mockFetchRoster(body: {
  vehicles: RosterVehicle[];
  assignments: Array<Omit<RosterAssignment, "effectiveFrom"> & { effectiveFrom?: string }>;
}) {
  const normalized = {
    vehicles: body.vehicles,
    assignments: body.assignments.map((a) => ({
      effectiveFrom: "2026-01-01T00:00:00Z",
      ...a,
    })),
  };
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => normalized,
  } as Response);
}

describe("ConnectorSource — REST pull API bootstrap (default)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fleetRoster.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has type 'connector'", () => {
    expect(new ConnectorSource().type).toBe("connector");
  });

  it("fetches the roster from rosterUrl with a timeout signal", async () => {
    const fetchMock = mockFetchRoster({
      vehicles: [{ vehicleId: "V1", callsign: "AMB-1" }],
      assignments: [{ deviceId: "D1", vehicleId: "V1", source: "fitted_gps" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const source = new ConnectorSource();
    await source.connect({ rosterUrl: ROSTER_URL });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(ROSTER_URL);
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("builds a roster of bound vehicles keyed by real ids", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchRoster({
        vehicles: [
          { vehicleId: "V1", callsign: "AMB-1" },
          { vehicleId: "V2", callsign: "AMB-2" },
        ],
        // V2 has no assignment → unbound → omitted.
        assignments: [{ deviceId: "D1", vehicleId: "V1", source: "fitted_gps" }],
      })
    );

    const source = new ConnectorSource();
    await source.connect({ rosterUrl: ROSTER_URL });

    const vehicles = await source.getVehicles();
    expect(vehicles).toHaveLength(1); // only V1 is bound
    expect(vehicles[0]).toMatchObject({ id: "V1", name: "AMB-1" });

    // The roster carries the real device id for V1 — telemetry keys off this.
    expect(fleetRoster.devicesForVehicle("V1")).toEqual([{ deviceId: "D1", source: "fitted_gps" }]);
  });

  it("maps a vehicle to multiple bound devices (fitted_gps + shift)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchRoster({
        vehicles: [{ vehicleId: "V1", plate: "KCA-001" }],
        assignments: [
          { deviceId: "D-gps", vehicleId: "V1", source: "fitted_gps" },
          { deviceId: "D-shift", vehicleId: "V1", source: "shift" },
        ],
      })
    );

    const source = new ConnectorSource();
    await source.connect({ rosterUrl: ROSTER_URL });

    expect(await source.getVehicles()).toEqual([{ id: "V1", name: "KCA-001" }]);
    const devices = fleetRoster.devicesForVehicle("V1");
    expect(devices.map((d) => d.deviceId).sort()).toEqual(["D-gps", "D-shift"]);
  });

  it("falls back rosterUrl → FLEET_ROSTER_URL env when no config url given", async () => {
    const fetchMock = mockFetchRoster({ vehicles: [], assignments: [] });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("FLEET_ROSTER_URL", "http://env.test/roster");

    const source = new ConnectorSource();
    await source.connect({});

    expect(fetchMock.mock.calls[0][0]).toBe("http://env.test/roster");
  });

  it("gracefully surfaces an empty/failed roster when the pull fails (no throw)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const source = new ConnectorSource();
    // connect() must NOT throw — a throw at bootstrap crashes the adapter.
    await expect(source.connect({ rosterUrl: ROSTER_URL })).resolves.toBeUndefined();

    expect(await source.getVehicles()).toEqual([]);
    const health = await source.healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.message).toMatch(/roster load failed/i);
  });

  it("gracefully handles a non-200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => ({}),
      } as Response)
    );

    const source = new ConnectorSource();
    await expect(source.connect({ rosterUrl: ROSTER_URL })).resolves.toBeUndefined();
    expect(await source.getVehicles()).toEqual([]);
    expect((await source.healthCheck()).healthy).toBe(false);
  });

  it("gracefully handles a roster that fails schema validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ vehicles: [{ wrong: "shape" }] }),
      } as Response)
    );

    const source = new ConnectorSource();
    await expect(source.connect({ rosterUrl: ROSTER_URL })).resolves.toBeUndefined();
    expect(await source.getVehicles()).toEqual([]);
    expect((await source.healthCheck()).healthy).toBe(false);
  });

  it("reports healthy with bound count after a successful pull", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchRoster({
        vehicles: [{ vehicleId: "V1" }],
        assignments: [{ deviceId: "D1", vehicleId: "V1", source: "shift" }],
      })
    );

    const source = new ConnectorSource();
    await source.connect({ rosterUrl: ROSTER_URL });
    const health = await source.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.message).toMatch(/1 bound vehicle/);
  });

  it("clears roster and reports unhealthy after disconnect", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchRoster({
        vehicles: [{ vehicleId: "V1" }],
        assignments: [{ deviceId: "D1", vehicleId: "V1", source: "shift" }],
      })
    );

    const source = new ConnectorSource();
    await source.connect({ rosterUrl: ROSTER_URL });
    expect((await source.healthCheck()).healthy).toBe(true);

    await source.disconnect();
    expect(fleetRoster.boundVehicleIds()).toEqual([]);
    expect((await source.healthCheck()).healthy).toBe(false);
  });

  it("throws from getVehicles when not connected", async () => {
    const source = new ConnectorSource();
    await expect(source.getVehicles()).rejects.toThrow(/not connected/);
  });
});

// ── compacted AVRO topic bootstrap (opt-in: bootstrap="topic") ──────

function vehicleMsg(data: {
  vehicle_id: string;
  callsign?: string | null;
  plate?: string | null;
  kind?: string | null;
}) {
  return { value: Buffer.from(JSON.stringify({ data })) };
}

function assignmentMsg(data: {
  device_id: string;
  vehicle_id: string | null;
  source: "fitted_gps" | "shift";
  effective_from?: string;
}) {
  return {
    value: Buffer.from(
      JSON.stringify({ data: { effective_from: "2026-01-01T00:00:00Z", ...data } })
    ),
  };
}

/**
 * Connects the source via the topic strategy and, in parallel, feeds the
 * captured eachMessage handler. A short `loadTimeoutMs` keeps the idle-window
 * resolution fast.
 */
async function connectWith(
  feed: (
    deliver: (topic: string, message: { value: Buffer | null }) => Promise<void>
  ) => Promise<void>,
  config: Record<string, unknown> = {}
): Promise<ConnectorSource> {
  const source = new ConnectorSource();
  const connectPromise = source.connect({
    bootstrap: "topic",
    brokers: "localhost:9092",
    schemaRegistry: "http://localhost:8081",
    loadTimeoutMs: 400,
    ...config,
  });

  // Wait for run() to register the handler, then feed messages.
  await vi.waitFor(() => expect(eachMessage).not.toBeNull());
  const deliver = async (topic: string, message: { value: Buffer | null }) => {
    await eachMessage!({ topic, message });
  };
  await feed(deliver);

  await connectPromise;
  return source;
}

describe("ConnectorSource — compacted AVRO topic bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eachMessage = null;
    fleetRoster.clear();
  });

  it("requires brokers and a schema registry url", async () => {
    const source = new ConnectorSource();
    await expect(
      source.connect({ bootstrap: "topic", schemaRegistry: "http://x" })
    ).rejects.toThrow(/broker/i);
    await expect(source.connect({ bootstrap: "topic", brokers: "localhost:9092" })).rejects.toThrow(
      /schemaRegistry/i
    );
  });

  it("subscribes to both fleet topics from the beginning", async () => {
    await connectWith(async () => {
      /* no messages — empty topics */
    });

    expect(mockSubscribe).toHaveBeenCalledWith({
      topics: [VEHICLE_TOPIC, ASSIGNMENT_TOPIC],
      fromBeginning: true,
    });
  });

  it("builds a roster of bound vehicles keyed by real ids", async () => {
    const source = await connectWith(async (deliver) => {
      await deliver(VEHICLE_TOPIC, vehicleMsg({ vehicle_id: "V1", callsign: "AMB-1" }));
      await deliver(VEHICLE_TOPIC, vehicleMsg({ vehicle_id: "V2", callsign: "AMB-2" }));
      await deliver(
        ASSIGNMENT_TOPIC,
        assignmentMsg({ device_id: "D1", vehicle_id: "V1", source: "fitted_gps" })
      );
    });

    const vehicles = await source.getVehicles();
    expect(vehicles).toHaveLength(1); // only V1 is bound
    expect(vehicles[0]).toMatchObject({ id: "V1", name: "AMB-1" });

    // The roster carries the real device id for V1.
    expect(fleetRoster.devicesForVehicle("V1")).toEqual([{ deviceId: "D1", source: "fitted_gps" }]);
  });

  it("omits a vehicle once its device is unbound", async () => {
    const source = await connectWith(async (deliver) => {
      await deliver(VEHICLE_TOPIC, vehicleMsg({ vehicle_id: "V1", callsign: "AMB-1" }));
      await deliver(
        ASSIGNMENT_TOPIC,
        assignmentMsg({ device_id: "D1", vehicle_id: "V1", source: "fitted_gps" })
      );
      await deliver(
        ASSIGNMENT_TOPIC,
        assignmentMsg({ device_id: "D1", vehicle_id: null, source: "fitted_gps" })
      );
    });

    expect(await source.getVehicles()).toEqual([]);
  });

  it("skips undecodable / invalid messages without failing the load", async () => {
    const source = await connectWith(async (deliver) => {
      // Garbage envelope (missing data.vehicle_id).
      await deliver(VEHICLE_TOPIC, { value: Buffer.from(JSON.stringify({ data: {} })) });
      // Valid binding still lands.
      await deliver(VEHICLE_TOPIC, vehicleMsg({ vehicle_id: "V1" }));
      await deliver(
        ASSIGNMENT_TOPIC,
        assignmentMsg({ device_id: "D1", vehicle_id: "V1", source: "shift" })
      );
    });

    const vehicles = await source.getVehicles();
    expect(vehicles.map((v) => v.id)).toEqual(["V1"]);
  });

  it("clears roster and reports unhealthy after disconnect", async () => {
    const source = await connectWith(async (deliver) => {
      await deliver(
        ASSIGNMENT_TOPIC,
        assignmentMsg({ device_id: "D1", vehicle_id: "V1", source: "shift" })
      );
    });
    expect((await source.healthCheck()).healthy).toBe(true);

    await source.disconnect();
    expect(mockDisconnect).toHaveBeenCalled();
    expect(fleetRoster.boundVehicleIds()).toEqual([]);
    expect((await source.healthCheck()).healthy).toBe(false);
  });
});
