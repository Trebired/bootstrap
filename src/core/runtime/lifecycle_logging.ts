import type {
  BootstrapLifecycleEvent,
  NormalizedBootstrapLogger,
} from "#63np0sf1s6f9";

const LIFECYCLE_LOG_GROUP = "lifecycle";
const WARNING_EVENTS = new Set([
    "bootstrap:failure",
    "hook:failure",
    "shutdown:forced",
]);

function logBootstrapLifecycleEvent(
  logger: NormalizedBootstrapLogger,
  event: BootstrapLifecycleEvent,
): void {
  const level = WARNING_EVENTS.has(event.type) ? "warn" : "info";
  logger[level](LIFECYCLE_LOG_GROUP, event.type, normalizeLifecycleEventMetadata(event));
}

function normalizeLifecycleEventMetadata(event: BootstrapLifecycleEvent): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  addMetadata(metadata, "state", event.state);
  addMetadata(metadata, "phase", event.phase);
  addMetadata(metadata, "subsystem_id", event.subsystemId);
  addMetadata(metadata, "target", event.target);
  addMetadata(metadata, "name", event.name);
  addMetadata(metadata, "duration_ms", event.durationMs);
  addMetadata(metadata, "timeout_ms", event.timeoutMs);
  addMetadata(metadata, "reason", event.reason);
  addMetadata(metadata, "readiness", event.readiness);
  addMetadata(metadata, "availability", event.availability);
  addMetadata(metadata, "error", event.error);
  return metadata;
}

function addMetadata(metadata: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) metadata[key] = value;
}

export { logBootstrapLifecycleEvent, normalizeLifecycleEventMetadata };
