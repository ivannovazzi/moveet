import type { Request, Response } from "express";
import type { AdapterConfig, PluginConfig } from "../plugins/types";
import type { CandidatePlugin, ConfigValidationReport } from "../plugins/validation";
import type { StartupConfig } from "../utils/config";

/**
 * `POST /config/validate` — dry-run configuration check.
 *
 * Reports what the current (or a supplied) configuration WOULD activate, with a
 * precise per-plugin reason for anything malformed. It never mutates the running
 * plugin set and never contacts a backend.
 *
 * The two failure modes the adapter must not conflate:
 *
 *  - **Malformed config** — reported here as `valid: false` with per-plugin
 *    errors. The operator has to fix it; startup refuses to boot on it.
 *  - **Valid config, unreachable backend** — NOT detectable here (by design, we
 *    do not connect). That case is intentionally fail-soft at startup and shows
 *    up as an unhealthy/absent plugin in `GET /health`.
 */

const DRY_RUN_NOTE =
  "Dry run: no plugin was instantiated, connected, replaced or removed. Backend " +
  "reachability is NOT tested here — a plugin reported valid can still be skipped " +
  "at startup if its backend is unreachable, which is intentional fail-soft " +
  "behaviour and is visible in GET /health.";

export interface ConfigValidateDeps {
  manager: {
    validateConfig(candidate: {
      source?: CandidatePlugin | null;
      sinks?: CandidatePlugin[];
    }): ConfigValidationReport;
    getConfig(): AdapterConfig;
  };
  /**
   * Re-resolve the startup configuration (env vars + config file) from scratch,
   * so an operator can edit the file and re-check without restarting.
   */
  resolveStartupConfig: () => StartupConfig;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse one `{ type, config }` entry from the request body. Throws on garbage. */
function parseCandidate(raw: unknown, label: string): CandidatePlugin {
  if (!isPlainObject(raw)) {
    throw new Error(`'${label}' must be an object of the form { type, config }`);
  }
  if (typeof raw.type !== "string" || raw.type.trim() === "") {
    throw new Error(`'${label}.type' must be a non-empty string`);
  }
  if (raw.config != null && !isPlainObject(raw.config)) {
    throw new Error(`'${label}.config' must be a JSON object`);
  }
  return {
    type: raw.type.trim(),
    config: (raw.config as PluginConfig | undefined) ?? {},
    origin: "request",
  };
}

export function createConfigValidateHandler(deps: ConfigValidateDeps) {
  return function configValidateHandler(req: Request, res: Response): void {
    const body: unknown = req.body ?? {};
    if (!isPlainObject(body)) {
      res.status(400).json({ error: "Request body must be a JSON object" });
      return;
    }

    const active = deps.manager.getConfig();
    const activeSet = { source: active.activeSource, sinks: [...active.activeSinks] };

    const hasCandidate = "source" in body || "sinks" in body;

    let candidate: { source?: CandidatePlugin | null; sinks?: CandidatePlugin[] };
    let checked: "request-body" | "startup-config";
    let configFile: string | null = null;

    if (hasCandidate) {
      // A caller-supplied candidate: reject a malformed *request* with 400.
      // That is distinct from a well-formed request describing invalid config,
      // which is a 200 report with valid:false.
      try {
        const source = body.source == null ? null : parseCandidate(body.source, "source");
        let sinks: CandidatePlugin[] = [];
        if (body.sinks != null) {
          if (!Array.isArray(body.sinks)) {
            throw new Error("'sinks' must be an array of { type, config } objects");
          }
          sinks = body.sinks.map((s, i) => parseCandidate(s, `sinks[${i}]`));
        }
        candidate = { source, sinks };
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
        return;
      }
      checked = "request-body";
    } else {
      checked = "startup-config";
      try {
        const resolved = deps.resolveStartupConfig();
        configFile = resolved.origins.configFile;
        candidate = {
          source: {
            type: resolved.source.type,
            config: resolved.source.config,
            origin: resolved.origins.source,
          },
          sinks: resolved.sinks.map((s) => ({
            type: s.type,
            config: s.config,
            origin: resolved.origins.sinks[s.type],
          })),
        };
      } catch (err) {
        // Resolution itself failed (bad JSON in an env var, unreadable or
        // malformed config file). Still a configuration error the operator must
        // fix — reported as an invalid config, not a server fault.
        const message = err instanceof Error ? err.message : String(err);
        res.json({
          valid: false,
          checked,
          configFile: null,
          resolutionError: message,
          source: null,
          sinks: [],
          wouldActivate: { source: null, sinks: [] },
          active: activeSet,
          errors: [message],
          warnings: [],
          backendConnectivity: { checked: false, note: DRY_RUN_NOTE },
        });
        return;
      }
    }

    const report = deps.manager.validateConfig(candidate);

    res.json({
      valid: report.valid,
      checked,
      configFile,
      source: report.source,
      sinks: report.sinks,
      wouldActivate: report.wouldActivate,
      active: activeSet,
      errors: report.errors,
      warnings: report.warnings,
      backendConnectivity: { checked: false, note: DRY_RUN_NOTE },
    });
  };
}
