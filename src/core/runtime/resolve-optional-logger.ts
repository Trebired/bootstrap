import { resolveLogger } from "#c5bjtgzvarhf";
import type {
  BootstrapLogger,
  BootstrapLoggerAdapter,
  NormalizedBootstrapLogger,
} from "#63np0sf1s6f9";

type OptionalBootstrapLoggerOptions = {
  logger?: BootstrapLogger;
  loggerAdapter?: BootstrapLoggerAdapter;
};

function resolveOptionalBootstrapLogger(
  options: OptionalBootstrapLoggerOptions,
): NormalizedBootstrapLogger | undefined {
  return options.logger || options.loggerAdapter
  ? resolveLogger(options.logger, options.loggerAdapter)
  : undefined;
}

export { resolveOptionalBootstrapLogger };
export type { OptionalBootstrapLoggerOptions };
