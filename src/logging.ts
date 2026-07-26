import {
  resolveLogger as resolveSharedLogger,
} from "@package/logger-adapter";

import type {
  BootstrapLogger,
  BootstrapLoggerAdapter,
  NormalizedBootstrapLogger,
} from "./types.js";

function resolveLogger(
  logger?: BootstrapLogger,
  adapter?: BootstrapLoggerAdapter,
): NormalizedBootstrapLogger {
  return resolveSharedLogger({
    adapter,
    fallback: "console",
    logger,
    source: "@package/bootstrap",
  }) as NormalizedBootstrapLogger;
}

export { resolveLogger };
