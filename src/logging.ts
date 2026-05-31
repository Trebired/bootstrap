import {
  resolveLogger as resolveSharedLogger,
} from "@trebired/logger-adapter";

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
    source: "@trebired/bootstrap",
  }) as NormalizedBootstrapLogger;
}

export { resolveLogger };
