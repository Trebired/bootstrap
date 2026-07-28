import { BOOTSTRAP_LOG_GROUP } from "#go3m4pwdqt48";
import { resolveLogger } from "#c5bjtgzvarhf";
import type {
  BootstrapLifecycleEvent,
  BootstrapLifecycleListener,
  BootstrapLifecycleLoggerLevel,
  BootstrapLifecycleLoggerOptions,
  NormalizedBootstrapLogger,
} from "#63np0sf1s6f9";

const DEFAULT_WARNING_EVENTS = new Set([
  "bootstrap:failure",
  "hook:failure",
  "shutdown:forced",
]);

function createBootstrapLifecycleLogger(
  options: BootstrapLifecycleLoggerOptions = {},
): BootstrapLifecycleListener {
  const logger = resolveOptionalLogger(options);
  const group = options.group || BOOTSTRAP_LOG_GROUP;
  const resolveLevel = options.level || resolveDefaultLifecycleLogLevel;
  const resolveMessage = options.message || ((event: BootstrapLifecycleEvent) => event.type);

  return (event) => {
    if (!logger) return;
    logger[resolveLevel(event)](group, resolveMessage(event), normalizeLifecycleEventMetadata(event));
  };
}

function resolveDefaultLifecycleLogLevel(event: BootstrapLifecycleEvent): BootstrapLifecycleLoggerLevel {
  return DEFAULT_WARNING_EVENTS.has(event.type) ? "warn" : "info";
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

function resolveOptionalLogger(options: BootstrapLifecycleLoggerOptions): NormalizedBootstrapLogger | undefined {
  return options.logger || options.loggerAdapter
    ? resolveLogger(options.logger, options.loggerAdapter)
    : undefined;
}

export {
  createBootstrapLifecycleLogger,
  normalizeLifecycleEventMetadata,
  resolveDefaultLifecycleLogLevel,
};
