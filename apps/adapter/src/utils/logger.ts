import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["*.apiKey", "*.password", "*.token", "*.secret"],
  transport: isDev ? { target: "pino-pretty", options: { colorize: true } } : undefined,
});

export const createLogger = (module: string) => logger.child({ module });

export default logger;
