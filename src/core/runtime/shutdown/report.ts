import type {
  BootstrapShutdownOptions,
  BootstrapShutdownReport,
  BootstrapShutdownStepResult,
} from "#63np0sf1s6f9";

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

export { buildShutdownReport, formatStepId };
