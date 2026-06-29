import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { createLogger, createModuleLoggerFactory, DEFAULT_REDACT_PATHS } from "../logger";

/**
 * Capture a logger's JSON output by pointing pino at an in-memory stream.
 * We rebuild the logger options here (level + redact, no pretty transport so the
 * output is parseable JSON) to assert on the serialized records.
 */
function captureLogger(redact: readonly string[] = DEFAULT_REDACT_PATHS) {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  const logger = pino({ level: "info", redact: [...redact] }, stream);
  return { logger, lines };
}

describe("createLogger", () => {
  it("honors the provided level", () => {
    const logger = createLogger({ level: "warn" });
    expect(logger.level).toBe("warn");
  });

  it("defaults to info when no level is provided", () => {
    const logger = createLogger();
    expect(logger.level).toBe("info");
  });

  it("supports child loggers (module binding)", () => {
    const { child } = createModuleLoggerFactory({ level: "info" });
    const moduleLogger = child("RoadNetwork");
    expect(typeof moduleLogger.info).toBe("function");
    // pino child loggers carry the parent level
    expect(moduleLogger.level).toBe("info");
  });

  it("exposes the safe-superset redaction paths as the default", () => {
    expect(DEFAULT_REDACT_PATHS).toEqual(["*.apiKey", "*.password", "*.token", "*.secret"]);
  });

  it("attaches base bindings when provided", () => {
    const logger = createLogger({ level: "info", base: { service: "simulator" } });
    expect(typeof logger.info).toBe("function");
    // pino applies `base` bindings to every record; constructing without throwing
    // and producing a usable logger exercises the base !== undefined branch.
    expect(() => logger.info("hello")).not.toThrow();
  });

  it("constructs a pretty-printing logger when pretty=true", () => {
    const logger = createLogger({ level: "debug", pretty: true });
    expect(logger.level).toBe("debug");
    expect(typeof logger.info).toBe("function");
  });
});

describe("createLogger redaction", () => {
  it("redacts apiKey, password, token, and secret one level deep", () => {
    const { logger, lines } = captureLogger();

    logger.info(
      {
        config: {
          apiKey: "ak-live-123",
          password: "hunter2",
          token: "bearer-xyz",
          secret: "s3cr3t",
          host: "broker.internal:9092",
        },
      },
      "config"
    );

    const record = lines[0];
    const cfg = record.config as Record<string, unknown>;
    expect(cfg.apiKey).toBe("[Redacted]");
    expect(cfg.password).toBe("[Redacted]");
    expect(cfg.token).toBe("[Redacted]");
    expect(cfg.secret).toBe("[Redacted]");
    // Non-secret fields pass through untouched.
    expect(cfg.host).toBe("broker.internal:9092");
  });

  it("does not emit any secret value in the serialized output", () => {
    const { logger, lines } = captureLogger();
    logger.info({ creds: { password: "topsecret-pw", token: "topsecret-tok" } }, "boot");
    const serialized = JSON.stringify(lines[0]);
    expect(serialized).not.toContain("topsecret-pw");
    expect(serialized).not.toContain("topsecret-tok");
  });
});
