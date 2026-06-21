import { logPackageInitialized } from "@trebired/logger-adapter";

import { BOOTSTRAP_LOG_GROUP } from "../constants.js";
import { resolveLogger } from "../logging.js";
import { loadModuleFile, nextImportRevision } from "../module/import.js";
import { invokeModuleHandler, resolveModuleHandler } from "../module/handler.js";
import { extractParamsOverrideFromFile } from "../params/extract.js";
import { envVerbose } from "../utils/env.js";
import { formatError } from "../utils/errors.js";
import { isDir, readFileCached } from "../utils/files.js";
import { isRecord, toNumber, toString } from "../utils/values.js";
import { discoverBootstrapFiles, resolveDependencies, resolveDirOption } from "./discovery.js";
import type {
  BootstrapContext,
  BootstrapDegradeOptions,
  BootstrapDegradeReport,
  BootstrapDisposable,
  BootstrapLifecycleEvent,
  BootstrapLifecycleListener,
  BootstrapOptions,
  BootstrapOwnedResourceHandle,
  BootstrapOwnedResourceOptions,
  BootstrapPhase,
  BootstrapRunReport,
  BootstrapRuntime,
  BootstrapShutdownOptions,
  BootstrapShutdownReport,
  BootstrapShutdownStepResult,
  BootstrapSnapshot,
  BootstrapSubsystemDefinition,
  LifecycleState,
} from "../types.js";

type InternalOwnedResource = {
  cleanup: () => Promise<void>;
  forceCleanup: (() => Promise<void>) | null;
  name: string;
  subsystemId: string;
  timeoutMs: number | null;
  active: boolean;
};

type InternalSubsystem = {
  id: string;
  name: string;
  order: number;
  dependsOn: string[];
  source: "registered" | "scanned-legacy" | "scanned-subsystem";
  bootstrapHook: ((context: BootstrapContext) => Promise<unknown>) | null;
  shutdownHook: ((context: BootstrapContext) => Promise<unknown>) | null;
  degradeHook: ((context: BootstrapContext) => Promise<unknown>) | null;
};

type InternalStepOptions = {
  phase: Exclude<BootstrapPhase, "bootstrap">;
  subsystemId: string;
  target: "subsystem" | "resource";
  name: string;
  timeoutMs: number | null;
  run: () => Promise<void>;
  force?: (() => Promise<void>) | null;
};

type RuntimeState = {
  state: LifecycleState;
  readiness: boolean;
  availability: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}

function hasOwnFunction(obj: unknown, key: string): boolean {
  if (!obj || typeof obj !== "object") return false;
  const descriptor = Object.getOwnPropertyDescriptor(obj, key);
  return Boolean(descriptor && typeof descriptor.value === "function");
}

function isDisposableObject(value: unknown): value is Exclude<BootstrapDisposable, Function> {
  if (!value || typeof value !== "object") return false;
  return [
    "abort",
    "close",
    "destroy",
    "disconnect",
    "dispose",
    "kill",
    "stop",
    "terminate",
  ].some((key) => hasOwnFunction(value, key));
}

function createCleanupFromDisposable(resource: BootstrapDisposable | unknown, options?: BootstrapOwnedResourceOptions): {
  cleanup: () => Promise<void>;
  forceCleanup: (() => Promise<void>) | null;
} | null {
  const explicitCleanup = options?.cleanup;
  const explicitForce = options?.forceCleanup;

  if (explicitCleanup) {
    return {
      cleanup: async () => {
        await Promise.resolve(explicitCleanup(resource));
      },
      forceCleanup: explicitForce
        ? async () => {
          await Promise.resolve(explicitForce(resource));
        }
        : null,
    };
  }

  if (isFunction(resource)) {
    return {
      cleanup: async () => {
        await Promise.resolve(resource());
      },
      forceCleanup: explicitForce
        ? async () => {
          await Promise.resolve(explicitForce(resource));
        }
        : null,
    };
  }

  if (!isDisposableObject(resource)) return null;

  const method = ["dispose", "close", "stop", "terminate", "disconnect", "destroy", "abort", "kill"]
    .find((key) => hasOwnFunction(resource, key));

  if (!method) return null;

  const cleanup = async () => {
    await Promise.resolve((resource as Record<string, (...args: unknown[]) => unknown>)[method]());
  };

  const forceMethod = explicitForce
    ? async () => {
      await Promise.resolve(explicitForce(resource));
    }
    : ["destroy", "abort", "kill", "terminate"]
      .find((key) => key !== method && hasOwnFunction(resource, key));

  return {
    cleanup,
    forceCleanup: typeof forceMethod === "function"
      ? forceMethod
      : forceMethod
        ? async () => {
          await Promise.resolve((resource as Record<string, (...args: unknown[]) => unknown>)[forceMethod]());
        }
        : null,
  };
}

function normalizeSubsystemDefinition(
  definition: BootstrapSubsystemDefinition,
  fallbackOrder: number,
): InternalSubsystem {
  const id = toString(definition.id).trim();
  if (!id) throw new Error("bootstrap-subsystem-missing-id");

  return {
    id,
    name: toString(definition.name).trim() || id,
    order: Number.isFinite(toNumber(definition.order)) ? Number(toNumber(definition.order)) : fallbackOrder,
    dependsOn: Array.isArray(definition.dependsOn) ? definition.dependsOn.map((item) => String(item).trim()).filter(Boolean) : [],
    source: "registered",
    bootstrapHook: definition.bootstrap ? async (context) => await Promise.resolve(definition.bootstrap!(context)) : null,
    shutdownHook: definition.shutdown ? async (context) => await Promise.resolve(definition.shutdown!(context)) : null,
    degradeHook: definition.degrade ? async (context) => await Promise.resolve(definition.degrade!(context)) : null,
  };
}

function resolveLifecycleSubsystemExport(mod: unknown, fallbackId: string, fallbackOrder: number): InternalSubsystem | null {
  const candidates: unknown[] = [];
  if (mod && typeof mod === "object" && isRecord((mod as Record<string, unknown>).subsystem)) {
    candidates.push((mod as Record<string, unknown>).subsystem);
  }
  if (isRecord(mod)) candidates.push(mod);
  if (isRecord((mod as Record<string, unknown> | null)?.default)) {
    candidates.push((mod as Record<string, unknown>).default);
  }

  for (const candidate of candidates) {
    const bootstrapFn = hasOwnFunction(candidate, "bootstrap")
      ? (candidate as Record<string, (...args: unknown[]) => unknown>).bootstrap
      : hasOwnFunction(candidate, "attach")
        ? (candidate as Record<string, (...args: unknown[]) => unknown>).attach
        : null;
    const shutdownFn = hasOwnFunction(candidate, "shutdown")
      ? (candidate as Record<string, (...args: unknown[]) => unknown>).shutdown
      : null;
    const degradeFn = hasOwnFunction(candidate, "degrade")
      ? (candidate as Record<string, (...args: unknown[]) => unknown>).degrade
      : null;

    if (!bootstrapFn && !shutdownFn && !degradeFn) continue;

    const candidateRecord = candidate as Record<string, unknown>;
    const id = toString(candidateRecord.id).trim() || fallbackId;

    return {
      id,
      name: toString(candidateRecord.name).trim() || id,
      order: Number.isFinite(toNumber(candidateRecord.order)) ? Number(toNumber(candidateRecord.order)) : fallbackOrder,
      dependsOn: Array.isArray(candidateRecord.dependsOn)
        ? candidateRecord.dependsOn.map((item) => String(item).trim()).filter(Boolean)
        : [],
      source: "scanned-subsystem",
      bootstrapHook: bootstrapFn ? async (context) => await Promise.resolve(bootstrapFn(context)) : null,
      shutdownHook: shutdownFn ? async (context) => await Promise.resolve(shutdownFn(context)) : null,
      degradeHook: degradeFn ? async (context) => await Promise.resolve(degradeFn(context)) : null,
    };
  }

  return null;
}

function orderSubsystems(subsystems: InternalSubsystem[]): InternalSubsystem[] {
  const byId = new Map<string, InternalSubsystem>();
  const edges = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const subsystem of subsystems) {
    if (byId.has(subsystem.id)) throw new Error(`bootstrap-subsystem-duplicate-id:${subsystem.id}`);
    byId.set(subsystem.id, subsystem);
    indegree.set(subsystem.id, 0);
    edges.set(subsystem.id, []);
  }

  for (const subsystem of subsystems) {
    for (const dep of subsystem.dependsOn) {
      if (!byId.has(dep)) throw new Error(`bootstrap-subsystem-missing-dependency:${subsystem.id}->${dep}`);
      edges.get(dep)!.push(subsystem.id);
      indegree.set(subsystem.id, (indegree.get(subsystem.id) || 0) + 1);
    }
  }

  const queue = subsystems
    .filter((subsystem) => (indegree.get(subsystem.id) || 0) === 0)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const ordered: InternalSubsystem[] = [];

  while (queue.length) {
    const current = queue.shift()!;
    ordered.push(current);

    for (const nextId of edges.get(current.id) || []) {
      const nextInDegree = (indegree.get(nextId) || 0) - 1;
      indegree.set(nextId, nextInDegree);
      if (nextInDegree === 0) {
        queue.push(byId.get(nextId)!);
        queue.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      }
    }
  }

  if (ordered.length !== subsystems.length) throw new Error("bootstrap-subsystem-cycle");
  return ordered;
}

class BootstrapRuntimeImpl implements BootstrapRuntime {
  private readonly options: BootstrapOptions;
  private readonly logger;
  private readonly verbose: boolean;
  private readonly dependencies: Record<string, unknown>;
  private readonly listeners = new Set<BootstrapLifecycleListener>();
  private readonly staticSubsystems: InternalSubsystem[] = [];
  private readonly lifecycleOptions;

  private runController: AbortController = new AbortController();
  private state: RuntimeState = {
    state: "idle",
    readiness: false,
    availability: false,
  };
  private bootPromise: Promise<BootstrapRunReport> | null = null;
  private shutdownPromise: Promise<BootstrapShutdownReport> | null = null;
  private degradePromise: Promise<BootstrapDegradeReport> | null = null;
  private shutdownRequested: BootstrapShutdownOptions | null = null;
  private scanGeneration = 0;
  private dynamicSubsystems: InternalSubsystem[] = [];
  private subsystemOrder: InternalSubsystem[] = [];
  private subsystemMap = new Map<string, InternalSubsystem>();
  private startedSubsystems: string[] = [];
  private failedSubsystems = new Set<string>();
  private ownedResources = new Map<string, InternalOwnedResource[]>();
  private lastSummary = {
    scanned: 0,
    loaded: 0,
    skipped: 0,
    failed: 0,
  };
  private lastBootstrapReport: BootstrapRunReport | null = null;
  private lastShutdownReport: BootstrapShutdownReport | null = null;
  private degradeCompletedForRun = false;

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

    if (this.lifecycleOptions.onEvent) this.listeners.add(this.lifecycleOptions.onEvent);

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
    if (this.state.state === "ready" && this.lastBootstrapReport) return this.lastBootstrapReport;
    if (this.state.state === "stopped") {
      if (!this.lifecycleOptions.allowRestart) throw new Error("bootstrap-restart-disabled");
      this.resetForRestart();
    }
    if (this.bootPromise) return this.bootPromise;

    this.bootPromise = this.doBootstrap();
    try {
      const report = await this.bootPromise;
      this.lastBootstrapReport = report;
      return report;
    } finally {
      this.bootPromise = null;
    }
  }

  async degrade(options: BootstrapDegradeOptions = {}): Promise<BootstrapDegradeReport> {
    if (this.state.state === "idle" || this.state.state === "stopped") {
      return {
        state: this.state.state,
        reason: options.reason,
        readiness: this.state.readiness,
        availability: this.state.availability,
        steps: [],
      };
    }

    if (this.degradeCompletedForRun) {
      return {
        state: this.state.state,
        reason: options.reason,
        readiness: this.state.readiness,
        availability: this.state.availability,
        steps: [],
      };
    }

    if (this.degradePromise) return this.degradePromise;

    this.degradePromise = this.doDegrade(options);
    try {
      return await this.degradePromise;
    } finally {
      this.degradePromise = null;
    }
  }

  async shutdown(options: BootstrapShutdownOptions = {}): Promise<BootstrapShutdownReport> {
    if (this.shutdownPromise) return this.shutdownPromise;
    if (this.state.state === "stopped" && this.lastShutdownReport) return this.lastShutdownReport;

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

    this.shutdownPromise = this.doShutdown(options);
    try {
      const report = await this.shutdownPromise;
      this.lastShutdownReport = report;
      return report;
    } finally {
      this.shutdownPromise = null;
    }
  }

  private emit(event: BootstrapLifecycleEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error(BOOTSTRAP_LOG_GROUP, `event-listener-failed :: ${formatError(error)}`);
      }
    }
  }

  private setLifecycleState(state: LifecycleState): void {
    this.state = {
      ...this.state,
      state,
    };
  }

  private setReadiness(value: boolean, reason?: string): void {
    if (this.state.readiness === value) return;
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

  private setAvailability(value: boolean, reason?: string): void {
    if (this.state.availability === value) return;
    this.state = {
      ...this.state,
      availability: value,
    };
  }

  private resetForRestart(): void {
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

  private async doBootstrap(): Promise<BootstrapRunReport> {
    this.resetForRestart();
    this.setLifecycleState("bootstrapping");
    this.emit({
      type: "bootstrap:start",
      state: this.state.state,
      timestamp: nowIso(),
      readiness: this.state.readiness,
      availability: this.state.availability,
    });

    await this.loadScannedSubsystems();

    const ordered = orderSubsystems([...this.staticSubsystems, ...this.dynamicSubsystems]);
    this.subsystemOrder = ordered;
    this.subsystemMap = new Map(ordered.map((subsystem) => [subsystem.id, subsystem]));

    for (const subsystem of ordered) {
      const context = this.createContext(subsystem);
      try {
        let result: unknown;
        if (subsystem.bootstrapHook) {
          result = await subsystem.bootstrapHook(context);
        }

        if (result !== undefined) {
          const owned = this.createOwnedResource(subsystem.id, result, {
            name: `${subsystem.name}#return`,
          });
          if (owned) this.addOwnedResource(subsystem.id, owned);
        }

        this.startedSubsystems.push(subsystem.id);
        if (subsystem.source !== "registered") this.lastSummary.loaded += 1;
      } catch (error) {
        this.failedSubsystems.add(subsystem.id);
        if (subsystem.source !== "registered") this.lastSummary.failed += 1;
        this.setLifecycleState("failed");
        this.emit({
          type: "bootstrap:failure",
          state: this.state.state,
          timestamp: nowIso(),
          subsystemId: subsystem.id,
          error,
          summary: { ...this.lastSummary },
        });

        await this.shutdown({
          reason: `bootstrap_failure:${subsystem.id}`,
        });

        const failure = new Error(`bootstrap-subsystem-failed:${subsystem.id}`);
        (failure as Error & { cause?: unknown; report?: BootstrapRunReport }).cause = error;
        (failure as Error & { cause?: unknown; report?: BootstrapRunReport }).report = {
          state: this.state.state,
          readiness: this.state.readiness,
          availability: this.state.availability,
          summary: { ...this.lastSummary },
          startedSubsystems: this.startedSubsystems.slice(),
          failedSubsystems: Array.from(this.failedSubsystems),
        };
        throw failure;
      }
    }

    if (this.shutdownRequested) {
      this.setLifecycleState("degrading");
      this.setAvailability(false, this.shutdownRequested.reason);
      this.setReadiness(false, this.shutdownRequested.reason);
    } else {
      this.setLifecycleState("ready");
      this.setAvailability(true);
      this.setReadiness(true);
    }

    const report: BootstrapRunReport = {
      state: this.state.state,
      readiness: this.state.readiness,
      availability: this.state.availability,
      summary: { ...this.lastSummary },
      startedSubsystems: this.startedSubsystems.slice(),
      failedSubsystems: Array.from(this.failedSubsystems),
    };

    this.emit({
      type: "bootstrap:finish",
      state: this.state.state,
      timestamp: nowIso(),
      readiness: this.state.readiness,
      availability: this.state.availability,
      summary: report.summary,
      report,
    });

    return report;
  }

  private async loadScannedSubsystems(): Promise<void> {
    const dir = resolveDirOption(this.options);
    if (!dir) return;

    if (!isDir(dir)) {
      this.logger.fail(BOOTSTRAP_LOG_GROUP, `dir-missing :: ${dir}`);
      throw new Error("bootstrap-dir-missing");
    }

    const discovered = discoverBootstrapFiles({
      dir,
      scan: this.options.scan,
      verbose: this.verbose,
      logger: this.logger,
    });
    const fileCodeCache = new Map<string, string | null>();
    const importRevision = nextImportRevision();

    this.lastSummary.scanned += discovered.summary.scanned;

    for (const [index, file] of discovered.ordered.entries()) {
      if (this.verbose) this.logger.info(BOOTSTRAP_LOG_GROUP, `load :: ${file.relativePath}`);

      let imported: unknown;
      try {
        imported = await loadModuleFile(file.abs, importRevision);
      } catch (error) {
        this.logger.error(BOOTSTRAP_LOG_GROUP, `load-failed :: ${file.relativePath}: ${formatError(error)}`);
        this.lastSummary.failed += 1;
        continue;
      }

      const lifecycleSubsystem = resolveLifecycleSubsystemExport(
        imported,
        file.relativePath,
        this.scanGeneration + index,
      );

      if (lifecycleSubsystem) {
        this.dynamicSubsystems.push(lifecycleSubsystem);
        continue;
      }

      const code = readFileCached(fileCodeCache, file.abs);
      const handler = resolveModuleHandler(imported);
      if (!handler) {
        if (this.verbose) this.logger.info(BOOTSTRAP_LOG_GROUP, `skip (no-handler) :: ${file.relativePath}`);
        this.lastSummary.skipped += 1;
        continue;
      }

      const paramsOverride = extractParamsOverrideFromFile({
        code,
        exportShape: handler.exportShape,
        runtimeFn: handler.runtimeFn,
      });
      const paramsSource = paramsOverride && paramsOverride.length ? "file" : "runtime";

      this.dynamicSubsystems.push({
        id: file.relativePath,
        name: file.relativePath,
        order: this.scanGeneration + index,
        dependsOn: [],
        source: "scanned-legacy",
        bootstrapHook: async () => {
          const ok = await invokeModuleHandler({
            handler,
            dependencies: this.dependencies,
            tag: file.relativePath,
            paramsOverride,
            paramsSource,
            verbose: this.verbose,
            logger: this.logger,
          });

          if (!ok) throw new Error(`bootstrap-legacy-module-failed:${file.relativePath}`);
          return undefined;
        },
        shutdownHook: null,
        degradeHook: null,
      });
    }

    this.scanGeneration += discovered.ordered.length + 1;
  }

  private createOwnedResource(
    subsystemId: string,
    resource: BootstrapDisposable | unknown,
    options?: BootstrapOwnedResourceOptions,
  ): InternalOwnedResource | null {
    const normalized = createCleanupFromDisposable(resource, options);
    if (!normalized) return null;

    return {
      subsystemId,
      name: options?.name || `${subsystemId}#resource-${(this.ownedResources.get(subsystemId)?.length || 0) + 1}`,
      cleanup: normalized.cleanup,
      forceCleanup: normalized.forceCleanup,
      timeoutMs: typeof options?.timeoutMs === "number" ? options.timeoutMs : null,
      active: true,
    };
  }

  private addOwnedResource(subsystemId: string, resource: InternalOwnedResource): void {
    const list = this.ownedResources.get(subsystemId) || [];
    list.push(resource);
    this.ownedResources.set(subsystemId, list);
  }

  private createContext(subsystem: InternalSubsystem): BootstrapContext {
    return {
      subsystem: {
        id: subsystem.id,
        name: subsystem.name,
        dependsOn: subsystem.dependsOn.slice(),
      },
      deps: this.dependencies,
      signal: this.runController.signal,
      own: (resource, options) => {
        const owned = this.createOwnedResource(subsystem.id, resource, options);
        if (!owned) throw new Error(`bootstrap-owned-resource-unsupported:${subsystem.id}`);
        this.addOwnedResource(subsystem.id, owned);
        return this.makeOwnedHandle(subsystem.id, owned);
      },
      addCleanup: (cleanup, options) => {
        const owned = this.createOwnedResource(subsystem.id, cleanup, {
          name: options?.name,
          timeoutMs: options?.timeoutMs,
          forceCleanup: options?.forceCleanup
            ? () => options.forceCleanup!()
            : undefined,
        });
        if (!owned) throw new Error(`bootstrap-owned-resource-unsupported:${subsystem.id}`);
        this.addOwnedResource(subsystem.id, owned);
        return this.makeOwnedHandle(subsystem.id, owned);
      },
      readiness: {
        enable: (reason?: string) => {
          this.setReadiness(true, reason);
        },
        disable: (reason?: string) => {
          this.setReadiness(false, reason);
        },
        isReady: () => this.state.readiness,
      },
      availability: {
        enable: (reason?: string) => {
          this.setAvailability(true, reason);
        },
        disable: (reason?: string) => {
          this.setAvailability(false, reason);
        },
        isAvailable: () => this.state.availability,
      },
      getState: () => this.state.state,
      getSnapshot: () => this.getSnapshot(),
    };
  }

  private makeOwnedHandle(subsystemId: string, resource: InternalOwnedResource): BootstrapOwnedResourceHandle {
    return {
      name: resource.name,
      dispose: async () => {
        if (!resource.active) return;
        await resource.cleanup();
        resource.active = false;
      },
      unregister: () => {
        resource.active = false;
        const list = this.ownedResources.get(subsystemId) || [];
        this.ownedResources.set(
          subsystemId,
          list.filter((item) => item !== resource),
        );
      },
    };
  }

  private async doDegrade(options: BootstrapDegradeOptions): Promise<BootstrapDegradeReport> {
    this.setLifecycleState("degrading");
    this.setAvailability(false, options.reason);
    this.setReadiness(false, options.reason);

    const steps: BootstrapShutdownStepResult[] = [];

    for (const subsystemId of this.startedSubsystems.slice().reverse()) {
      const subsystem = this.subsystemMap.get(subsystemId);
      if (!subsystem?.degradeHook) continue;

      const result = await this.runStep({
        phase: "degrade",
        subsystemId,
        target: "subsystem",
        name: subsystem.name,
        timeoutMs: null,
        run: async () => {
          await subsystem.degradeHook!(this.createContext(subsystem));
        },
      });
      steps.push(result);
    }

    this.degradeCompletedForRun = true;

    return {
      state: this.state.state,
      reason: options.reason,
      readiness: this.state.readiness,
      availability: this.state.availability,
      steps,
    };
  }

  private async doShutdown(options: BootstrapShutdownOptions): Promise<BootstrapShutdownReport> {
    if (this.bootPromise && this.state.state !== "failed") {
      try {
        await this.bootPromise;
      } catch {
        // A bootstrap failure already triggered cleanup flow for started subsystems.
      }
    }

    if (this.state.state === "idle") {
      this.setLifecycleState("stopped");
      const report: BootstrapShutdownReport = {
        state: "stopped",
        timeoutMs: typeof options.timeoutMs === "number" ? options.timeoutMs : null,
        reason: options.reason,
        steps: [],
        completed: [],
        failed: [],
        timedOut: [],
        forced: [],
      };
      this.emit({
        type: "shutdown:finish",
        state: this.state.state,
        timestamp: nowIso(),
        report,
      });
      return report;
    }

    if (!this.degradeCompletedForRun) {
      await this.degrade({
        reason: options.reason,
      });
    }

    this.setLifecycleState("shutting_down");

    const timeoutMs = typeof options.timeoutMs === "number"
      ? options.timeoutMs
      : typeof this.lifecycleOptions.shutdownTimeoutMs === "number"
        ? this.lifecycleOptions.shutdownTimeoutMs
        : null;
    const startedAt = Date.now();
    const deadline = timeoutMs == null ? Number.POSITIVE_INFINITY : startedAt + timeoutMs;
    const steps: BootstrapShutdownStepResult[] = [];

    for (const subsystemId of this.startedSubsystems.slice().reverse()) {
      const subsystem = this.subsystemMap.get(subsystemId);
      if (!subsystem) continue;

      const remaining = Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : null;

      if (subsystem.shutdownHook) {
        steps.push(await this.runStep({
          phase: "shutdown",
          subsystemId,
          target: "subsystem",
          name: subsystem.name,
          timeoutMs: remaining,
          run: async () => {
            await subsystem.shutdownHook!(this.createContext(subsystem));
          },
        }));
      }

      const resources = (this.ownedResources.get(subsystemId) || []).slice().reverse();
      for (const resource of resources) {
        if (!resource.active) continue;
        const resourceRemaining = Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : null;
        steps.push(await this.runStep({
          phase: "cleanup",
          subsystemId,
          target: "resource",
          name: resource.name,
          timeoutMs: resource.timeoutMs ?? resourceRemaining,
          run: async () => {
            await resource.cleanup();
            resource.active = false;
          },
          force: resource.forceCleanup,
        }));
      }
    }

    const forced = steps.filter((step) => step.status === "forced").map((step) => `${step.phase}:${step.subsystemId}:${step.name}`);
    if (forced.length) {
      this.emit({
        type: "shutdown:forced",
        state: this.state.state,
        timestamp: nowIso(),
        timeoutMs: timeoutMs == null ? undefined : timeoutMs,
        report: {
          state: "stopped",
          timeoutMs,
          reason: options.reason,
          steps,
          completed: [],
          failed: [],
          timedOut: [],
          forced,
        },
      });
    }

    this.runController.abort();
    this.setLifecycleState("stopped");
    this.setAvailability(false, options.reason);
    this.setReadiness(false, options.reason);

    const report: BootstrapShutdownReport = {
      state: "stopped",
      timeoutMs,
      reason: options.reason,
      steps,
      completed: steps.filter((step) => step.status === "completed").map((step) => `${step.phase}:${step.subsystemId}:${step.name}`),
      failed: steps.filter((step) => step.status === "failed").map((step) => `${step.phase}:${step.subsystemId}:${step.name}`),
      timedOut: steps.filter((step) => step.status === "timed_out").map((step) => `${step.phase}:${step.subsystemId}:${step.name}`),
      forced,
    };

    this.emit({
      type: "shutdown:finish",
      state: this.state.state,
      timestamp: nowIso(),
      report,
    });

    return report;
  }

  private async runStep(options: InternalStepOptions): Promise<BootstrapShutdownStepResult> {
    const startedAt = Date.now();

    this.emit({
      type: "hook:start",
      state: this.state.state,
      timestamp: nowIso(),
      phase: options.phase,
      subsystemId: options.subsystemId,
      target: options.target,
      name: options.name,
      timeoutMs: options.timeoutMs == null ? undefined : options.timeoutMs,
    });

    const timeoutMs = options.timeoutMs != null && Number.isFinite(options.timeoutMs)
      ? Math.max(0, options.timeoutMs)
      : null;

    try {
      if (timeoutMs == null) {
        await options.run();
        const durationMs = Date.now() - startedAt;
        this.emit({
          type: "hook:finish",
          state: this.state.state,
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

      let timer: ReturnType<typeof setTimeout> | null = null;
      await Promise.race([
        options.run(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error("bootstrap-shutdown-timeout"));
          }, timeoutMs);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });

      const durationMs = Date.now() - startedAt;
      this.emit({
        type: "hook:finish",
        state: this.state.state,
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
    } catch (error) {
      const durationMs = Date.now() - startedAt;

      if (String((error as Error)?.message || "") === "bootstrap-shutdown-timeout") {
        if (options.force) {
          try {
            await options.force();
            this.emit({
              type: "hook:failure",
              state: this.state.state,
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
              status: "forced",
              durationMs,
              error,
            };
          } catch (forceError) {
            this.emit({
              type: "hook:failure",
              state: this.state.state,
              timestamp: nowIso(),
              phase: options.phase,
              subsystemId: options.subsystemId,
              target: options.target,
              name: options.name,
              durationMs,
              error: forceError,
            });
            return {
              target: options.target,
              phase: options.phase,
              subsystemId: options.subsystemId,
              name: options.name,
              status: "failed",
              durationMs,
              error: forceError,
            };
          }
        }

        this.emit({
          type: "hook:failure",
          state: this.state.state,
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
          status: "timed_out",
          durationMs,
          error,
        };
      }

      this.emit({
        type: "hook:failure",
        state: this.state.state,
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
        status: "failed",
        durationMs,
        error,
      };
    }
  }
}

function createBootstrap(options: BootstrapOptions = {}): BootstrapRuntime {
  return new BootstrapRuntimeImpl(options);
}

export { createBootstrap };
