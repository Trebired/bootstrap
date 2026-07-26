import type { BootstrapShutdownStepResult } from "#63np0sf1s6f9";
import type { BootstrapRuntimeImpl } from "#6pk4xe2v9lab";
import type { InternalStepOptions } from "./shared.js";
import { nowIso } from "./shared.js";

async function runRuntimeStep(runtime: BootstrapRuntimeImpl, options: InternalStepOptions): Promise<BootstrapShutdownStepResult> {
  const startedAt = Date.now();
  runtime.emit(createHookStartEvent(runtime, options));

  try {
    await runStepBody(options);
    return createCompletedStep(runtime, options, startedAt);
  } catch (error) {
    return handleStepFailure(runtime, options, startedAt, error);
  }
}

async function runStepBody(options: InternalStepOptions): Promise<void> {
  const timeoutMs = options.timeoutMs != null && Number.isFinite(options.timeoutMs)
    ? Math.max(0, options.timeoutMs)
    : null;

  if (timeoutMs == null) {
    await options.run();
    return;
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([
    options.run(),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("bootstrap-shutdown-timeout"));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function createHookStartEvent(runtime: BootstrapRuntimeImpl, options: InternalStepOptions) {
  return {
    type: "hook:start" as const,
    state: runtime.state.state,
    timestamp: nowIso(),
    phase: options.phase,
    subsystemId: options.subsystemId,
    target: options.target,
    name: options.name,
    timeoutMs: options.timeoutMs == null ? undefined : options.timeoutMs,
  };
}

function createCompletedStep(
  runtime: BootstrapRuntimeImpl,
  options: InternalStepOptions,
  startedAt: number,
): BootstrapShutdownStepResult {
  const durationMs = Date.now() - startedAt;
  runtime.emit({
    type: "hook:finish",
    state: runtime.state.state,
    timestamp: nowIso(),
    phase: options.phase,
    subsystemId: options.subsystemId,
    target: options.target,
    name: options.name,
    durationMs,
  });

  return {
    target: options.target,
    phase: options.phase,
    subsystemId: options.subsystemId,
    name: options.name,
    status: "completed",
    durationMs,
  };
}

async function handleStepFailure(
  runtime: BootstrapRuntimeImpl,
  options: InternalStepOptions,
  startedAt: number,
  error: unknown,
): Promise<BootstrapShutdownStepResult> {
  const durationMs = Date.now() - startedAt;
  if (String((error as Error)?.message || "") !== "bootstrap-shutdown-timeout") {
    return emitFailure(runtime, options, durationMs, "failed", error);
  }

  if (!options.force) {
    return emitFailure(runtime, options, durationMs, "timed_out", error);
  }

  try {
    await options.force();
    return emitFailure(runtime, options, durationMs, "forced", error);
  } catch (forceError) {
    return emitFailure(runtime, options, durationMs, "failed", forceError);
  }
}

function emitFailure(
  runtime: BootstrapRuntimeImpl,
  options: InternalStepOptions,
  durationMs: number,
  status: BootstrapShutdownStepResult["status"],
  error: unknown,
): BootstrapShutdownStepResult {
  runtime.emit({
    type: "hook:failure",
    state: runtime.state.state,
    timestamp: nowIso(),
    phase: options.phase,
    subsystemId: options.subsystemId,
    target: options.target,
    name: options.name,
    durationMs,
    error,
  });

  return {
    target: options.target,
    phase: options.phase,
    subsystemId: options.subsystemId,
    name: options.name,
    status,
    durationMs,
    error,
  };
}

export {
  runRuntimeStep,
};
