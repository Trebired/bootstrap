import type {
  BootstrapDegradeReport,
  BootstrapShutdownOptions,
  BootstrapShutdownReport,
} from "#63np0sf1s6f9";

type BootstrapShutdownControllerOptions = {
  defaultExitCode?: number;
  group?: string;
  logger?: import("#63np0sf1s6f9").BootstrapLogger;
  loggerAdapter?: import("#63np0sf1s6f9").BootstrapLoggerAdapter;
  terminate?: (exitCode: number) => unknown | Promise<unknown>;
  timeoutMs?: number;
};

type BootstrapShutdownControllerRequestOptions = BootstrapShutdownOptions& {
  exitCode?: number;
};

type BootstrapShutdownControllerResult = {
  degradeError?: unknown;
  degraded?: BootstrapDegradeReport;
  exitCode: number;
  reason?: string;
  shutdown?: BootstrapShutdownReport;
  shutdownError?: unknown;
  terminated: boolean;
};

type BootstrapSignalRegistrationCleanup =
|void
|(() => unknown)
| {
  dispose?: () => unknown;
  off?: () => unknown;
  remove?: () => unknown;
  unsubscribe?: () => unknown;
};

type BootstrapShutdownSignalBindingOptions = {
  exitCode?: number;
  once: (signal: string, handler: () => void) => BootstrapSignalRegistrationCleanup;
  reason?: (signal: string) => string;
  signals?: readonly string[];
};

type BootstrapShutdownController = {
  bindSignals: (options: BootstrapShutdownSignalBindingOptions) => () => void;
  request: (options?: BootstrapShutdownControllerRequestOptions) => Promise<BootstrapShutdownControllerResult>;
};

export type {
  BootstrapShutdownController,
  BootstrapShutdownControllerOptions,
  BootstrapShutdownControllerRequestOptions,
  BootstrapShutdownControllerResult,
  BootstrapShutdownSignalBindingOptions,
  BootstrapSignalRegistrationCleanup,
};
