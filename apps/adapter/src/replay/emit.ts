import { PluginManager } from "../plugins/manager";
import { loadConfig, logConfig } from "../utils/config";
import { createLogger } from "../utils/logger";
import { ReplayEmitter } from "./ReplayEmitter";

// Sink plugins (same set the server registers in index.ts).
import { GraphQLSink } from "../plugins/sinks/graphql";
import { RestSink } from "../plugins/sinks/rest";
import { RedpandaSink } from "../plugins/sinks/redpanda";
import { RedisPubSubSink } from "../plugins/sinks/redis";
import { WebhookSink } from "../plugins/sinks/webhook";
import { ConsoleSink } from "../plugins/sinks/console";

const logger = createLogger("emit");

interface Flags {
  in?: string;
  realism: boolean;
  seed?: number;
}

/** Minimal `--key=value` / `--key value` / `--flag` parser. */
function parseFlags(argv: string[]): Flags {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      out[body.slice(0, eq)] = body.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      out[body] = argv[++i];
    } else {
      out[body] = true;
    }
  }
  const realismRaw = out.realism;
  const realism =
    realismRaw === true || realismRaw === "on" || realismRaw === "true" ? true : false;
  return {
    in: typeof out.in === "string" ? out.in : undefined,
    realism,
    seed: out.seed != null ? Number(out.seed) : undefined,
  };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (!flags.in) {
    logger.error("Missing --in=<path-to-truth.ndjson>");
    process.exit(1);
  }

  // Reuse the adapter's existing startup config (SINK_TYPES / SINK_<TYPE>_CONFIG
  // / REALISM_CONFIG) — no parallel config system.
  const config = loadConfig();
  logConfig(config);

  const pluginManager = new PluginManager();
  pluginManager.registerSink("graphql", () => new GraphQLSink());
  pluginManager.registerSink("rest", () => new RestSink());
  pluginManager.registerSink("redpanda", () => new RedpandaSink());
  pluginManager.registerSink("redis", () => new RedisPubSubSink());
  pluginManager.registerSink("webhook", () => new WebhookSink());
  pluginManager.registerSink("console", () => new ConsoleSink());

  for (const sink of config.sinks) {
    await pluginManager.addSink(sink.type, sink.config);
    logger.info({ sink: sink.type }, "Sink configured");
  }

  const emitter = new ReplayEmitter({
    ndjsonPath: flags.in,
    realism: flags.realism,
    seed: flags.seed,
    // Force the engine enabled in realism-on mode (the replay's whole point);
    // otherwise inherit the env REALISM_CONFIG knobs.
    realismConfig: flags.realism ? { ...config.realism, enabled: true } : config.realism,
    publish: (updates) => pluginManager.publishToSinks(updates),
  });

  logger.info({ in: flags.in, realism: flags.realism, seed: flags.seed }, "Starting replay");
  await emitter.run();
  await pluginManager.shutdown();
  logger.info("Replay finished");
}

main().catch((err) => {
  logger.error({ err }, "Replay failed");
  process.exit(1);
});
