import type { BootstrapLogger, NormalizedBootstrapLogger } from "./types.js";

type ConsoleLevel = "info" | "warn" | "error";

function fallbackLogger(level: ConsoleLevel) {
  return (group: string, message: string, metadata?: unknown) => {
    const prefix = `[${group}] ${message}`;
    if (metadata !== undefined) console[level](prefix, metadata);
    else console[level](prefix);
  };
}

function resolveLogger(logger?: BootstrapLogger): NormalizedBootstrapLogger {
  const source = logger && typeof logger === "object" ? logger : null;

  return {
    info: typeof source?.info === "function" ? source.info.bind(source) : fallbackLogger("info"),
    warn: typeof source?.warn === "function" ? source.warn.bind(source) : fallbackLogger("warn"),
    error: typeof source?.error === "function" ? source.error.bind(source) : fallbackLogger("error"),
    fail: typeof source?.fail === "function" ? source.fail.bind(source) : fallbackLogger("error"),
  };
}

export { resolveLogger };
