import { logPackageInitialized } from "@trebired/logger-adapter";

import { BOOTSTRAP_LOG_GROUP } from "#go3m4pwdqt48";
import { resolveLogger } from "#c5bjtgzvarhf";
import { envVerbose } from "#vl1kc579x5ul";
import { formatError } from "#7vfj5fhk8sp9";
import type {
  BootstrapDegradeOptions,
  BootstrapDegradeReport,
  BootstrapLifecycleEvent,
  BootstrapLifecycleListener,
  BootstrapOptions,
  BootstrapOwnedResourceHandle,
  BootstrapOwnedResourceOptions,
  BootstrapRunReport,
  BootstrapRuntime,
  BootstrapShutdownOptions,
  BootstrapShutdownReport,
  BootstrapShutdownStepResult,
  BootstrapSnapshot,
  BootstrapSubsystemDefinition,
  LifecycleState,
} from "#63np0sf1s6f9";
import { resolveDependencies } from "./discovery.js";
import {
  addOwnedResource,
  createOwnedResource,
  createRuntimeContext,
  makeOwnedHandle,
} from "./runtime/context.js";
import {
  doRuntimeBootstrap,
  doRuntimeDegrade,
  doRuntimeShutdown,
} from "./runtime/lifecycle.js";
import {
  InternalOwnedResource,
  InternalStepOptions,
  InternalSubsystem,
  RuntimeState,
  normalizeSubsystemDefinition,
  nowIso,
} from "./runtime/shared.js";
import { runRuntimeStep } from "./runtime/steps.js";

class BootstrapRuntimeImpl implements BootstrapRuntime {
  readonly options: BootstrapOptions;
  readonly logger;
  readonly verbose: boolean;
  readonly dependencies: Record<string, unknown>;
  readonly listeners = new Set<BootstrapLifecycleListener>();
  readonly staticSubsystems: InternalSubsystem[] = [];
  readonly lifecycleOptions;

  runController: AbortController = new AbortController();
  state: RuntimeState = {
    state: "idle",
    readiness: false,
    availability: false,
  };
  bootPromise: Promise<BootstrapRunReport> | null = null;
  shutdownPromise: Promise<BootstrapShutdownReport> | null = null;
  degradePromise: Promise<BootstrapDegradeReport> | null = null;
  shutdownRequested: BootstrapShutdownOptions | null = null;
  scanGeneration = 0;
  dynamicSubsystems: InternalSubsystem[] = [];
  subsystemOrder: InternalSubsystem[] = [];
  subsystemMap = new Map<string, InternalSubsystem>();
  startedSubsystems: string[] = [];
  failedSubsystems = new Set<string>();
  ownedResources = new Map<string, InternalOwnedResource[]>();
  lastSummary = {
    scanned: 0,
    loaded: 0,
    skipped: 0,
    failed: 0,
  };
  lastBootstrapReport: BootstrapRunReport | null = null;
  lastShutdownReport: BootstrapShutdownReport | null = null;
  degradeCompletedForRun = false;

  constructor(options: BootstrapOptions = {}) {
    this.options = options;
    this.logger = resolveLogger(options.logger, options.loggerAdapter);
    this.verbose = typeof options.verbose === "boolean" ? options.verbose : envVerbose();
    this.dependencies = resolveDependencies(options);
    this.lifecycleOptions = options.lifecycle || {};

    logPackageInitialized({
      adapter: options.loggerAdapter,
      fallback: "console",
      group: "bootstrap.initialize",
      logger: options.logger,
      source: "@trebired/bootstrap",
    });

    if (this.lifecycleOptions.onEvent) {
      this.listeners.add(this.lifecycleOptions.onEvent);
    }

    for (const [index, definition] of (options.subsystems || []).entries()) {
      this.staticSubsystems.push(normalizeSubsystemDefinition(definition, index));
    }
  }

  registerSubsystem(definition: BootstrapSubsystemDefinition): BootstrapRuntime {
    if (this.state.state !== "idle" && this.state.state !== "stopped") {
      throw new Error("bootstrap-register-subsystem-after-start");
    }

    this.staticSubsystems.push(normalizeSubsystemDefinition(definition, this.staticSubsystems.length));
    return this;
  }

  onEvent(listener: BootstrapLifecycleListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): LifecycleState {
    return this.state.state;
  }

  isReady(): boolean {
    return this.state.readiness;
  }

  isAvailable(): boolean {
    return this.state.availability;
  }

  getSnapshot(): BootstrapSnapshot {
    return {
      state: this.state.state,
      readiness: this.state.readiness,
      availability: this.state.availability,
      startedSubsystems: this.startedSubsystems.slice(),
      failedSubsystems: Array.from(this.failedSubsystems),
      lastSummary: { ...this.lastSummary },
    };
  }

  async bootstrap(): Promise<BootstrapRunReport> {
    if (this.state.state === "ready" && this.lastBootstrapReport) {
      return this.lastBootstrapReport;
    }

    if (this.state.state === "stopped") {
      if (!this.lifecycleOptions.allowRestart) {
        throw new Error("bootstrap-restart-disabled");
      }

      this.resetForRestart();
    }

    if (this.bootPromise) {
      return this.bootPromise;
    }

    this.bootPromise = doRuntimeBootstrap(this);
    try {
      const report = await this.bootPromise;
      this.lastBootstrapReport = report;
      return report;
    } finally {
      this.bootPromise = null;
    }
  }

  async degrade(options: BootstrapDegradeOptions = {}): Promise<BootstrapDegradeReport> {
    if (this.state.state === "idle" || this.state.state === "stopped" || this.degradeCompletedForRun) {
      return {
        state: this.state.state,
        reason: options.reason,
        readiness: this.state.readiness,
        availability: this.state.availability,
        steps: [],
      };
    }

    if (this.degradePromise) {
      return this.degradePromise;
    }

    this.degradePromise = doRuntimeDegrade(this, options);
    try {
      return await this.degradePromise;
    } finally {
      this.degradePromise = null;
    }
  }

  async shutdown(options: BootstrapShutdownOptions = {}): Promise<BootstrapShutdownReport> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    if (this.state.state === "stopped" && this.lastShutdownReport) {
      return this.lastShutdownReport;
    }

    this.shutdownRequested = {
      reason: options.reason,
      timeoutMs: options.timeoutMs,
    };
    this.setAvailability(false, options.reason);
    this.setReadiness(false, options.reason);
    this.emit({
      type: "shutdown:requested",
      state: this.state.state === "idle" ? "idle" : "degrading",
      timestamp: nowIso(),
      reason: options.reason,
      readiness: this.state.readiness,
      availability: this.state.availability,
    });

    this.shutdownPromise = doRuntimeShutdown(this, options);
    try {
      const report = await this.shutdownPromise;
      this.lastShutdownReport = report;
      return report;
    } finally {
      this.shutdownPromise = null;
    }
  }

  emit(event: BootstrapLifecycleEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error(BOOTSTRAP_LOG_GROUP, `event-listener-failed :: ${formatError(error)}`);
      }
    }
  }

  setLifecycleState(state: LifecycleState): void {
    this.state = {
      ...this.state,
      state,
    };
  }

  setReadiness(value: boolean, reason?: string): void {
    if (this.state.readiness === value) {
      return;
    }

    this.state = {
      ...this.state,
      readiness: value,
    };
    this.emit({
      type: value ? "readiness:enabled" : "readiness:disabled",
      state: this.state.state,
      timestamp: nowIso(),
      reason,
      readiness: this.state.readiness,
      availability: this.state.availability,
    });
  }

  setAvailability(value: boolean, reason?: string): void {
    if (this.state.availability === value) {
      return;
    }

    this.state = {
      ...this.state,
      availability: value,
    };
  }

  resetForRestart(): void {
    this.runController = new AbortController();
    this.state = {
      state: "idle",
      readiness: false,
      availability: false,
    };
    this.shutdownRequested = null;
    this.dynamicSubsystems = [];
    this.subsystemOrder = [];
    this.subsystemMap = new Map<string, InternalSubsystem>();
    this.startedSubsystems = [];
    this.failedSubsystems = new Set<string>();
    this.ownedResources = new Map<string, InternalOwnedResource[]>();
    this.degradeCompletedForRun = false;
    this.lastSummary = {
      scanned: 0,
      loaded: 0,
      skipped: 0,
      failed: 0,
    };
  }

  createOwnedResource(subsystemId: string, resource: unknown, options?: BootstrapOwnedResourceOptions) {
    return createOwnedResource(this, subsystemId, resource, options);
  }

  addOwnedResource(subsystemId: string, resource: InternalOwnedResource): void {
    addOwnedResource(this, subsystemId, resource);
  }

  createContext(subsystem: InternalSubsystem) {
    return createRuntimeContext(this, subsystem);
  }

  makeOwnedHandle(subsystemId: string, resource: InternalOwnedResource): BootstrapOwnedResourceHandle {
    return makeOwnedHandle(this, subsystemId, resource);
  }

  runStep(options: InternalStepOptions): Promise<BootstrapShutdownStepResult> {
    return runRuntimeStep(this, options);
  }
}

function createBootstrap(options: BootstrapOptions = {}): BootstrapRuntime {
  return new BootstrapRuntimeImpl(options);
}

export { BootstrapRuntimeImpl, createBootstrap };
