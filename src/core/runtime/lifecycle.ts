import type {
  BootstrapDegradeOptions,
  BootstrapDegradeReport,
  BootstrapRunReport,
  BootstrapShutdownOptions,
  BootstrapShutdownReport,
  BootstrapShutdownStepResult,
} from "#63np0sf1s6f9";
import type { BootstrapRuntimeImpl } from "#6pk4xe2v9lab";
import { createRuntimeContext } from "./context.js";
import { loadScannedSubsystems } from "./scan.js";
import { nowIso, orderSubsystems } from "./shared.js";
import { runRuntimeStep } from "./steps.js";

async function doRuntimeBootstrap(runtime: BootstrapRuntimeImpl): Promise<BootstrapRunReport> {
  initializeBootstrap(runtime);
  await loadScannedSubsystems(runtime);
  const ordered = prepareOrderedSubsystems(runtime);

  for (const subsystem of ordered) {
    try {
      await bootstrapSubsystem(runtime, subsystem);
    } catch (error) {
      await handleBootstrapFailure(runtime, subsystem.id, error);
      throw createBootstrapFailure(runtime, subsystem.id, error);
    }
  }

  finalizeBootstrapState(runtime);
  const report = buildBootstrapReport(runtime);
  runtime.emit({
    type: "bootstrap:finish",
    state: runtime.state.state,
    timestamp: nowIso(),
    readiness: runtime.state.readiness,
    availability: runtime.state.availability,
    summary: report.summary,
    report,
  });
  return report;
}
async function doRuntimeDegrade(runtime: BootstrapRuntimeImpl, options: BootstrapDegradeOptions): Promise<BootstrapDegradeReport> {
  runtime.setLifecycleState("degrading");
  runtime.setAvailability(false, options.reason);
  runtime.setReadiness(false, options.reason);

  const steps = await runDegradeSteps(runtime);
  runtime.degradeCompletedForRun = true;

  return {
    state: runtime.state.state,
    reason: options.reason,
    readiness: runtime.state.readiness,
    availability: runtime.state.availability,
    steps,
  };
}
async function doRuntimeShutdown(runtime: BootstrapRuntimeImpl, options: BootstrapShutdownOptions): Promise<BootstrapShutdownReport> {
  await waitForBootstrapBeforeShutdown(runtime);
  if (runtime.state.state === "idle") {
    return finishIdleShutdown(runtime, options);
  }

  if (!runtime.degradeCompletedForRun) {
    await runtime.degrade({ reason: options.reason });
  }

  runtime.setLifecycleState("shutting_down");
  const timeoutMs = resolveShutdownTimeout(runtime, options);
  const steps = await collectShutdownSteps(runtime, options, timeoutMs);
  const report = finalizeShutdown(runtime, options, timeoutMs, steps);

  runtime.emit({
    type: "shutdown:finish",
    state: runtime.state.state,
    timestamp: nowIso(),
    report,
  });
  return report;
}

function initializeBootstrap(runtime: BootstrapRuntimeImpl): void {
  runtime.resetForRestart();
  runtime.setLifecycleState("bootstrapping");
  runtime.emit({
    type: "bootstrap:start",
    state: runtime.state.state,
    timestamp: nowIso(),
    readiness: runtime.state.readiness,
    availability: runtime.state.availability,
  });
}
function prepareOrderedSubsystems(runtime: BootstrapRuntimeImpl) {
  const ordered = orderSubsystems([...runtime.staticSubsystems, ...runtime.dynamicSubsystems]);
  runtime.subsystemOrder = ordered;
  runtime.subsystemMap = new Map(ordered.map((subsystem) => [subsystem.id, subsystem]));
  return ordered;
}
async function bootstrapSubsystem(
  runtime: BootstrapRuntimeImpl,
  subsystem: BootstrapRuntimeImpl["subsystemOrder"][number],
): Promise<void> {
  const context = createRuntimeContext(runtime, subsystem);
  const result = subsystem.bootstrapHook ? await subsystem.bootstrapHook(context) : undefined;
  if (result !== undefined) {
    const owned = runtime.createOwnedResource(subsystem.id, result, {
      name: `${subsystem.name}#return`,
    });
    if (owned) {
      runtime.addOwnedResource(subsystem.id, owned);
    }
  }

  runtime.startedSubsystems.push(subsystem.id);
  if (subsystem.source !== "registered") {
    runtime.lastSummary.loaded += 1;
  }
}

async function handleBootstrapFailure(runtime: BootstrapRuntimeImpl, subsystemId: string, error: unknown): Promise<void> {
  runtime.failedSubsystems.add(subsystemId);
  runtime.lastSummary.failed += 1;
  runtime.setLifecycleState("failed");
  runtime.emit({
    type: "bootstrap:failure",
    state: runtime.state.state,
    timestamp: nowIso(),
    subsystemId,
    error,
    summary: { ...runtime.lastSummary },
  });
  await runtime.shutdown({
    reason: `bootstrap_failure:${subsystemId}`,
  });
}
function createBootstrapFailure(runtime: BootstrapRuntimeImpl, subsystemId: string, error: unknown): Error {
  const failure = new Error(`bootstrap-subsystem-failed:${subsystemId}`);
  (failure as Error & { cause?: unknown; report?: BootstrapRunReport }).cause = error;
  (failure as Error & { cause?: unknown; report?: BootstrapRunReport }).report = buildBootstrapReport(runtime);
  return failure;
}
function finalizeBootstrapState(runtime: BootstrapRuntimeImpl): void {
  if (runtime.shutdownRequested) {
    runtime.setLifecycleState("degrading");
    runtime.setAvailability(false, runtime.shutdownRequested.reason);
    runtime.setReadiness(false, runtime.shutdownRequested.reason);
    return;
  }

  runtime.setLifecycleState("ready");
  runtime.setAvailability(true);
  runtime.setReadiness(true);
}
function buildBootstrapReport(runtime: BootstrapRuntimeImpl): BootstrapRunReport {
  return {
    state: runtime.state.state,
    readiness: runtime.state.readiness,
    availability: runtime.state.availability,
    summary: { ...runtime.lastSummary },
    startedSubsystems: runtime.startedSubsystems.slice(),
    failedSubsystems: Array.from(runtime.failedSubsystems),
  };
}
async function runDegradeSteps(runtime: BootstrapRuntimeImpl): Promise<BootstrapShutdownStepResult[]> {
  const steps: BootstrapShutdownStepResult[] = [];

  for (const subsystemId of runtime.startedSubsystems.slice().reverse()) {
    const subsystem = runtime.subsystemMap.get(subsystemId);
    if (!subsystem?.degradeHook) {
      continue;
    }

    steps.push(await runRuntimeStep(runtime, {
      phase: "degrade",
      subsystemId,
      target: "subsystem",
      name: subsystem.name,
      timeoutMs: null,
      run: async () => {
        await subsystem.degradeHook!(createRuntimeContext(runtime, subsystem));
      },
    }));
  }

  return steps;
}
async function waitForBootstrapBeforeShutdown(runtime: BootstrapRuntimeImpl): Promise<void> {
  if (!runtime.bootPromise || runtime.state.state === "failed") {
    return;
  }

  try {
    await runtime.bootPromise;
  } catch {
    // Bootstrap failure already triggered cleanup.
  }
}
function finishIdleShutdown(runtime: BootstrapRuntimeImpl, options: BootstrapShutdownOptions): BootstrapShutdownReport {
  runtime.setLifecycleState("stopped");
  const report = buildShutdownReport(options, null, []);
  runtime.emit({
    type: "shutdown:finish",
    state: runtime.state.state,
    timestamp: nowIso(),
    report,
  });
  return report;
}
function resolveShutdownTimeout(runtime: BootstrapRuntimeImpl, options: BootstrapShutdownOptions): number | null {
  return typeof options.timeoutMs === "number"
    ? options.timeoutMs
    : typeof runtime.lifecycleOptions.shutdownTimeoutMs === "number"
      ? runtime.lifecycleOptions.shutdownTimeoutMs
      : null;
}
async function collectShutdownSteps(
  runtime: BootstrapRuntimeImpl,
  options: BootstrapShutdownOptions,
  timeoutMs: number | null,
): Promise<BootstrapShutdownStepResult[]> {
  const deadline = timeoutMs == null ? Number.POSITIVE_INFINITY : Date.now() + timeoutMs;
  const steps: BootstrapShutdownStepResult[] = [];

  for (const subsystemId of runtime.startedSubsystems.slice().reverse()) {
    const subsystem = runtime.subsystemMap.get(subsystemId);
    if (!subsystem) {
      continue;
    }

    if (subsystem.shutdownHook) {
      steps.push(await createShutdownHookStep(runtime, subsystemId, subsystem.name, deadline, async () => {
        await subsystem.shutdownHook!(createRuntimeContext(runtime, subsystem));
      }));
    }

    for (const resource of (runtime.ownedResources.get(subsystemId) || []).slice().reverse()) {
      if (!resource.active) {
        continue;
      }

      steps.push(await createResourceCleanupStep(runtime, subsystemId, resource, deadline));
    }
  }

  emitForcedShutdown(runtime, options, timeoutMs, steps);
  return steps;
}
async function createShutdownHookStep(
  runtime: BootstrapRuntimeImpl,
  subsystemId: string,
  name: string,
  deadline: number,
  run: () => Promise<void>,
): Promise<BootstrapShutdownStepResult> {
  return runRuntimeStep(runtime, {
    phase: "shutdown",
    subsystemId,
    target: "subsystem",
    name,
    timeoutMs: remainingTime(deadline),
    run,
  });
}
async function createResourceCleanupStep(
  runtime: BootstrapRuntimeImpl,
  subsystemId: string,
  resource: BootstrapRuntimeImpl["ownedResources"] extends Map<string, Array<infer T>> ? T : never,
  deadline: number,
): Promise<BootstrapShutdownStepResult> {
  return runRuntimeStep(runtime, {
    phase: "cleanup",
    subsystemId,
    target: "resource",
    name: resource.name,
    timeoutMs: resource.timeoutMs ?? remainingTime(deadline),
    run: async () => {
      await resource.cleanup();
      resource.active = false;
    },
    force: resource.forceCleanup,
  });
}
function remainingTime(deadline: number): number | null {
  return Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : null;
}
function emitForcedShutdown(
  runtime: BootstrapRuntimeImpl,
  options: BootstrapShutdownOptions,
  timeoutMs: number | null,
  steps: BootstrapShutdownStepResult[],
): void {
  const forced = steps.filter((step) => step.status === "forced").map(formatStepId);
  if (!forced.length) {
    return;
  }

  runtime.emit({
    type: "shutdown:forced",
    state: runtime.state.state,
    timestamp: nowIso(),
    timeoutMs: timeoutMs == null ? undefined : timeoutMs,
    report: buildShutdownReport(options, timeoutMs, steps),
  });
}
function finalizeShutdown(
  runtime: BootstrapRuntimeImpl,
  options: BootstrapShutdownOptions,
  timeoutMs: number | null,
  steps: BootstrapShutdownStepResult[],
): BootstrapShutdownReport {
  runtime.runController.abort();
  runtime.setLifecycleState("stopped");
  runtime.setAvailability(false, options.reason);
  runtime.setReadiness(false, options.reason);
  return buildShutdownReport(options, timeoutMs, steps);
}
function buildShutdownReport(
  options: BootstrapShutdownOptions,
  timeoutMs: number | null,
  steps: BootstrapShutdownStepResult[],
): BootstrapShutdownReport {
  return {
    state: "stopped",
    timeoutMs,
    reason: options.reason,
    steps,
    completed: steps.filter((step) => step.status === "completed").map(formatStepId),
    failed: steps.filter((step) => step.status === "failed").map(formatStepId),
    timedOut: steps.filter((step) => step.status === "timed_out").map(formatStepId),
    forced: steps.filter((step) => step.status === "forced").map(formatStepId),
  };
}
function formatStepId(step: BootstrapShutdownStepResult): string {
  return `${step.phase}:${step.subsystemId}:${step.name}`;
}

export {
  doRuntimeBootstrap,
  doRuntimeDegrade,
  doRuntimeShutdown,
};
