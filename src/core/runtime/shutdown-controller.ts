import { BOOTSTRAP_LOG_GROUP } from "#go3m4pwdqt48";
import { resolveLogger } from "#c5bjtgzvarhf";
import type {
  BootstrapLogger,
  BootstrapLoggerAdapter,
  BootstrapRuntime,
  BootstrapShutdownController,
  BootstrapShutdownControllerOptions,
  BootstrapShutdownControllerRequestOptions,
  BootstrapShutdownControllerResult,
  BootstrapShutdownSignalBindingOptions,
  BootstrapSignalRegistrationCleanup,
  NormalizedBootstrapLogger,
} from "#63np0sf1s6f9";

const DEFAULT_SHUTDOWN_SIGNALS = [
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
] as const;

function createBootstrapShutdownController(
  runtime: BootstrapRuntime,
  options: BootstrapShutdownControllerOptions = {},
): BootstrapShutdownController {
  let inFlight: Promise<BootstrapShutdownControllerResult> | null = null;
  let completed: BootstrapShutdownControllerResult | null = null;

  const controller = {
    bindSignals: (signals: BootstrapShutdownSignalBindingOptions) => bindBootstrapShutdownSignals(controller, signals),
    request: (requestOptions: BootstrapShutdownControllerRequestOptions = {}) => {
      if (inFlight) return inFlight;
      if (completed) return Promise.resolve(completed);
      inFlight = requestBootstrapShutdown(runtime, options, requestOptions).then((result) => {
        completed = result;
        return result;
      }).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };

  return controller;
}

function bindBootstrapShutdownSignals(
  controller: Pick<BootstrapShutdownController, "request">,
  options: BootstrapShutdownSignalBindingOptions,
): () => void {
  const cleanups = (options.signals || DEFAULT_SHUTDOWN_SIGNALS).map((signal) => {
    const cleanup = options.once(signal, () => {
      void controller.request({
        exitCode: options.exitCode,
        reason: options.reason ? options.reason(signal) : `signal:${signal}`,
      });
    });
    return normalizeSignalCleanup(cleanup);
  }).filter(Boolean) as Array<() => void>;

  return () => {
    cleanups.slice().reverse().forEach((cleanup) => cleanup());
  };
}

async function requestBootstrapShutdown(
  runtime: BootstrapRuntime,
  options: BootstrapShutdownControllerOptions,
  requestOptions: BootstrapShutdownControllerRequestOptions,
): Promise<BootstrapShutdownControllerResult> {
  const logger = resolveOptionalLogger(options);
  const request = normalizeShutdownRequest(options, requestOptions);
  logShutdownRequested(logger, options.group, request);

  const result: BootstrapShutdownControllerResult = {
    exitCode: request.exitCode,
    reason: request.reason,
    terminated: false,
  };

  await degradeRuntime(runtime, logger, options.group, request, result);
  await shutdownRuntime(runtime, logger, options.group, request, result);
  if (options.terminate) await Promise.resolve(options.terminate(request.exitCode));
  result.terminated = Boolean(options.terminate);
  return result;
}

function normalizeShutdownRequest(
  options: BootstrapShutdownControllerOptions,
  request: BootstrapShutdownControllerRequestOptions,
) {
  return {
    exitCode: request.exitCode ?? options.defaultExitCode ?? 0,
    reason: request.reason,
    timeoutMs: request.timeoutMs ?? options.timeoutMs,
  };
}

async function degradeRuntime(
  runtime: BootstrapRuntime,
  logger: NormalizedBootstrapLogger | undefined,
  group: string | undefined,
  request: ReturnType<typeof normalizeShutdownRequest>,
  result: BootstrapShutdownControllerResult,
): Promise<void> {
  try {
    result.degraded = await runtime.degrade({ reason: request.reason });
  } catch (error) {
    result.degradeError = error;
    logShutdownFailure(logger, group, "shutdown:degrade-failure", request, error);
  }
}

async function shutdownRuntime(
  runtime: BootstrapRuntime,
  logger: NormalizedBootstrapLogger | undefined,
  group: string | undefined,
  request: ReturnType<typeof normalizeShutdownRequest>,
  result: BootstrapShutdownControllerResult,
): Promise<void> {
  try {
    result.shutdown = await runtime.shutdown({
      reason: request.reason,
      timeoutMs: request.timeoutMs,
    });
  } catch (error) {
    result.shutdownError = error;
    logShutdownFailure(logger, group, "shutdown:failure", request, error);
  }
}

function logShutdownRequested(
  logger: NormalizedBootstrapLogger | undefined,
  group: string | undefined,
  request: ReturnType<typeof normalizeShutdownRequest>,
): void {
  logger?.info(group || BOOTSTRAP_LOG_GROUP, "shutdown:requested", {
    exit_code: request.exitCode,
    reason: request.reason,
    timeout_ms: request.timeoutMs,
  });
}

function logShutdownFailure(
  logger: NormalizedBootstrapLogger | undefined,
  group: string | undefined,
  message: string,
  request: ReturnType<typeof normalizeShutdownRequest>,
  error: unknown,
): void {
  logger?.warn(group || BOOTSTRAP_LOG_GROUP, message, {
    exit_code: request.exitCode,
    reason: request.reason,
    timeout_ms: request.timeoutMs,
    error,
  });
}

function normalizeSignalCleanup(cleanup: BootstrapSignalRegistrationCleanup): (() => void) | null {
  if (typeof cleanup === "function") return () => void cleanup();
  if (!cleanup || typeof cleanup !== "object") return null;
  const method = ["unsubscribe", "dispose", "remove", "off"].find((key) => typeof cleanup[key] === "function");
  return method ? () => void cleanup[method]!() : null;
}

function resolveOptionalLogger(options: {
  logger?: BootstrapLogger;
  loggerAdapter?: BootstrapLoggerAdapter;
}): NormalizedBootstrapLogger | undefined {
  return options.logger || options.loggerAdapter
    ? resolveLogger(options.logger, options.loggerAdapter)
    : undefined;
}

export {
  bindBootstrapShutdownSignals,
  createBootstrapShutdownController,
};
