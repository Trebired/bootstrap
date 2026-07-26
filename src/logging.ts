import {
  resolveLogger as resolveSharedLogger,
} from "@package/logger-adapter";

import { BOOTSTRAP_PACKAGE_NAME } from "./constants.js";
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
    source: BOOTSTRAP_PACKAGE_NAME,
  }) as NormalizedBootstrapLogger;
}

export { resolveLogger };
