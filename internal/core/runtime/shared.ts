import { isRecord, toNumber, toString } from "#7iidjfwwxm9c";
import type {
  BootstrapContext,
  BootstrapDisposable,
  BootstrapOwnedResourceOptions,
  BootstrapPhase,
  BootstrapSubsystemDefinition,
  LifecycleState,
} from "#63np0sf1s6f9";

export type InternalOwnedResource = {
  cleanup: () => Promise<void>;
  forceCleanup: (() => Promise<void>) | null;
  name: string;
  subsystemId: string;
  timeoutMs: number | null;
  active: boolean;
};

export type InternalSubsystem = {
  id: string;
  name: string;
  order: number;
  dependsOn: string[];
  source: "registered" | "scanned-legacy" | "scanned-subsystem";
  bootstrapHook: ((context: BootstrapContext) => Promise<unknown>) | null;
  shutdownHook: ((context: BootstrapContext) => Promise<unknown>) | null;
  degradeHook: ((context: BootstrapContext) => Promise<unknown>) | null;
};

export type InternalStepOptions = {
  phase: Exclude<BootstrapPhase, "bootstrap">;
  subsystemId: string;
  target: "subsystem" | "resource";
  name: string;
  timeoutMs: number | null;
  run: () => Promise<void>;
  force?: (() => Promise<void>) | null;
};

export type RuntimeState = {
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
  if (!obj || typeof obj !== "object") {
    return false;
  }

  const descriptor = Object.getOwnPropertyDescriptor(obj, key);
  return Boolean(descriptor && typeof descriptor.value === "function");
}

function isDisposableObject(value: unknown): value is Exclude<BootstrapDisposable, Function> {
  if (!value || typeof value !== "object") {
    return false;
  }

  return ["abort", "close", "destroy", "disconnect", "dispose", "kill", "stop", "terminate"]
    .some((key) => hasOwnFunction(value, key));
}

function createCleanupFromDisposable(
  resource: BootstrapDisposable | unknown,
  options?: BootstrapOwnedResourceOptions,
): {
  cleanup: () => Promise<void>;
  forceCleanup: (() => Promise<void>) | null;
} | null {
  const explicitCleanup = options?.cleanup;
  const explicitForce = options?.forceCleanup;

  if (explicitCleanup) {
    return createExplicitCleanup(resource, explicitCleanup, explicitForce);
  }

  if (isFunction(resource)) {
    return createFunctionCleanup(resource, explicitForce);
  }

  return createObjectCleanup(resource, explicitForce);
}

function normalizeSubsystemDefinition(
  definition: BootstrapSubsystemDefinition,
  fallbackOrder: number,
): InternalSubsystem {
  const id = toString(definition.id).trim();
  if (!id) {
    throw new Error("bootstrap-subsystem-missing-id");
  }

  return {
    id,
    name: toString(definition.name).trim() || id,
    order: Number.isFinite(toNumber(definition.order)) ? Number(toNumber(definition.order)) : fallbackOrder,
    dependsOn: Array.isArray(definition.dependsOn)
      ? definition.dependsOn.map((item) => String(item).trim()).filter(Boolean)
      : [],
    source: "registered",
    bootstrapHook: createHook(definition.bootstrap),
    shutdownHook: createHook(definition.shutdown),
    degradeHook: createHook(definition.degrade),
  };
}

function resolveLifecycleSubsystemExport(mod: unknown, fallbackId: string, fallbackOrder: number): InternalSubsystem | null {
  for (const candidate of resolveSubsystemCandidates(mod)) {
    const hooks = resolveSubsystemHooks(candidate);
    if (!hooks.bootstrapHook && !hooks.shutdownHook && !hooks.degradeHook) {
      continue;
    }

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
      ...hooks,
    };
  }

  return null;
}

function orderSubsystems(subsystems: InternalSubsystem[]): InternalSubsystem[] {
  const graph = buildSubsystemGraph(subsystems);
  const queue = subsystems
    .filter((subsystem) => (graph.indegree.get(subsystem.id) || 0) === 0)
    .sort(compareSubsystems);
  const ordered: InternalSubsystem[] = [];

  while (queue.length) {
    const current = queue.shift()!;
    ordered.push(current);
    releaseSubsystemDependents(graph, current.id, queue);
  }

  if (ordered.length !== subsystems.length) {
    throw new Error("bootstrap-subsystem-cycle");
  }

  return ordered;
}

function createExplicitCleanup(
  resource: BootstrapDisposable | unknown,
  cleanup: NonNullable<BootstrapOwnedResourceOptions["cleanup"]>,
  forceCleanup?: BootstrapOwnedResourceOptions["forceCleanup"],
) {
  return {
    cleanup: async () => {
      await Promise.resolve(cleanup(resource));
    },
    forceCleanup: forceCleanup
      ? async () => {
        await Promise.resolve(forceCleanup(resource));
      }
      : null,
  };
}

function createFunctionCleanup(
  resource: (...args: unknown[]) => unknown,
  forceCleanup?: BootstrapOwnedResourceOptions["forceCleanup"],
) {
  return {
    cleanup: async () => {
      await Promise.resolve(resource());
    },
    forceCleanup: forceCleanup
      ? async () => {
        await Promise.resolve(forceCleanup(resource));
      }
      : null,
  };
}

function createObjectCleanup(
  resource: BootstrapDisposable | unknown,
  forceCleanup?: BootstrapOwnedResourceOptions["forceCleanup"],
) {
  if (!isDisposableObject(resource)) {
    return null;
  }

  const method = ["dispose", "close", "stop", "terminate", "disconnect", "destroy", "abort", "kill"]
    .find((key) => hasOwnFunction(resource, key));
  if (!method) {
    return null;
  }

  return {
    cleanup: async () => {
      await Promise.resolve((resource as Record<string, (...args: unknown[]) => unknown>)[method]());
    },
    forceCleanup: resolveForceCleanup(resource, method, forceCleanup),
  };
}

function resolveForceCleanup(
  resource: Exclude<BootstrapDisposable, Function>,
  cleanupMethod: string,
  forceCleanup?: BootstrapOwnedResourceOptions["forceCleanup"],
): (() => Promise<void>) | null {
  if (forceCleanup) {
    return async () => {
      await Promise.resolve(forceCleanup(resource));
    };
  }

  const forceMethod = ["destroy", "abort", "kill", "terminate"]
    .find((key) => key !== cleanupMethod && hasOwnFunction(resource, key));
  if (!forceMethod) {
    return null;
  }

  return async () => {
    await Promise.resolve((resource as Record<string, (...args: unknown[]) => unknown>)[forceMethod]());
  };
}

function createHook(fn: unknown) {
  return isFunction(fn)
    ? async (context: BootstrapContext) => await Promise.resolve(fn(context))
    : null;
}

function resolveSubsystemCandidates(mod: unknown): unknown[] {
  const candidates: unknown[] = [];

  if (mod && typeof mod === "object" && isRecord((mod as Record<string, unknown>).subsystem)) {
    candidates.push((mod as Record<string, unknown>).subsystem);
  }

  if (isRecord(mod)) {
    candidates.push(mod);
  }

  if (isRecord((mod as Record<string, unknown> | null)?.default)) {
    candidates.push((mod as Record<string, unknown>).default);
  }

  return candidates;
}

function resolveSubsystemHooks(candidate: unknown) {
  const record = candidate as Record<string, (...args: unknown[]) => unknown>;
  const bootstrapFn = hasOwnFunction(candidate, "bootstrap")
    ? record.bootstrap
    : hasOwnFunction(candidate, "attach")
      ? record.attach
      : null;

  return {
    bootstrapHook: bootstrapFn ? async (context: BootstrapContext) => await Promise.resolve(bootstrapFn(context)) : null,
    shutdownHook: hasOwnFunction(candidate, "shutdown")
      ? async (context: BootstrapContext) => await Promise.resolve(record.shutdown(context))
      : null,
    degradeHook: hasOwnFunction(candidate, "degrade")
      ? async (context: BootstrapContext) => await Promise.resolve(record.degrade(context))
      : null,
  };
}

function buildSubsystemGraph(subsystems: InternalSubsystem[]) {
  const byId = new Map<string, InternalSubsystem>();
  const edges = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const subsystem of subsystems) {
    if (byId.has(subsystem.id)) {
      throw new Error(`bootstrap-subsystem-duplicate-id:${subsystem.id}`);
    }

    byId.set(subsystem.id, subsystem);
    indegree.set(subsystem.id, 0);
    edges.set(subsystem.id, []);
  }

  for (const subsystem of subsystems) {
    for (const dependency of subsystem.dependsOn) {
      if (!byId.has(dependency)) {
        throw new Error(`bootstrap-subsystem-missing-dependency:${subsystem.id}->${dependency}`);
      }

      edges.get(dependency)!.push(subsystem.id);
      indegree.set(subsystem.id, (indegree.get(subsystem.id) || 0) + 1);
    }
  }

  return {
    byId,
    edges,
    indegree,
  };
}

function releaseSubsystemDependents(
  graph: ReturnType<typeof buildSubsystemGraph>,
  currentId: string,
  queue: InternalSubsystem[],
): void {
  for (const nextId of graph.edges.get(currentId) || []) {
    const nextInDegree = (graph.indegree.get(nextId) || 0) - 1;
    graph.indegree.set(nextId, nextInDegree);
    if (nextInDegree === 0) {
      queue.push(graph.byId.get(nextId)!);
      queue.sort(compareSubsystems);
    }
  }
}

function compareSubsystems(left: InternalSubsystem, right: InternalSubsystem): number {
  return left.order - right.order || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

export {
  createCleanupFromDisposable,
  nowIso,
  normalizeSubsystemDefinition,
  orderSubsystems,
  resolveLifecycleSubsystemExport,
};
