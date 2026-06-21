import type { BootstrapContext, BootstrapDisposable, BootstrapOwnedResourceHandle, BootstrapOwnedResourceOptions } from "#63np0sf1s6f9";
import type { BootstrapRuntimeImpl } from "#6pk4xe2v9lab";
import type { InternalOwnedResource, InternalSubsystem } from "./shared.js";
import { createCleanupFromDisposable } from "./shared.js";

function createOwnedResource(
  runtime: BootstrapRuntimeImpl,
  subsystemId: string,
  resource: BootstrapDisposable | unknown,
  options?: BootstrapOwnedResourceOptions,
): InternalOwnedResource | null {
  const normalized = createCleanupFromDisposable(resource, options);
  if (!normalized) {
    return null;
  }

  return {
    subsystemId,
    name: options?.name || `${subsystemId}#resource-${(runtime.ownedResources.get(subsystemId)?.length || 0) + 1}`,
    cleanup: normalized.cleanup,
    forceCleanup: normalized.forceCleanup,
    timeoutMs: typeof options?.timeoutMs === "number" ? options.timeoutMs : null,
    active: true,
  };
}

function addOwnedResource(runtime: BootstrapRuntimeImpl, subsystemId: string, resource: InternalOwnedResource): void {
  const list = runtime.ownedResources.get(subsystemId) || [];
  list.push(resource);
  runtime.ownedResources.set(subsystemId, list);
}

function createRuntimeContext(runtime: BootstrapRuntimeImpl, subsystem: InternalSubsystem): BootstrapContext {
  return {
    subsystem: {
      id: subsystem.id,
      name: subsystem.name,
      dependsOn: subsystem.dependsOn.slice(),
    },
    deps: runtime.dependencies,
    signal: runtime.runController.signal,
    own: (resource, options) => createRuntimeOwnedHandle(runtime, subsystem.id, resource, options),
    addCleanup: (cleanup, options) => createRuntimeOwnedHandle(runtime, subsystem.id, cleanup, {
      name: options?.name,
      timeoutMs: options?.timeoutMs,
      forceCleanup: options?.forceCleanup ? () => options.forceCleanup!() : undefined,
    }),
    readiness: {
      enable: (reason?: string) => runtime.setReadiness(true, reason),
      disable: (reason?: string) => runtime.setReadiness(false, reason),
      isReady: () => runtime.state.readiness,
    },
    availability: {
      enable: (reason?: string) => runtime.setAvailability(true, reason),
      disable: (reason?: string) => runtime.setAvailability(false, reason),
      isAvailable: () => runtime.state.availability,
    },
    getState: () => runtime.state.state,
    getSnapshot: () => runtime.getSnapshot(),
  };
}

function makeOwnedHandle(
  runtime: BootstrapRuntimeImpl,
  subsystemId: string,
  resource: InternalOwnedResource,
): BootstrapOwnedResourceHandle {
  return {
    name: resource.name,
    dispose: async () => {
      if (!resource.active) {
        return;
      }

      await resource.cleanup();
      resource.active = false;
    },
    unregister: () => {
      resource.active = false;
      const list = runtime.ownedResources.get(subsystemId) || [];
      runtime.ownedResources.set(subsystemId, list.filter((item) => item !== resource));
    },
  };
}

function createRuntimeOwnedHandle(
  runtime: BootstrapRuntimeImpl,
  subsystemId: string,
  resource: BootstrapDisposable | unknown,
  options?: BootstrapOwnedResourceOptions,
): BootstrapOwnedResourceHandle {
  const owned = createOwnedResource(runtime, subsystemId, resource, options);
  if (!owned) {
    throw new Error(`bootstrap-owned-resource-unsupported:${subsystemId}`);
  }

  addOwnedResource(runtime, subsystemId, owned);
  return makeOwnedHandle(runtime, subsystemId, owned);
}

export {
  addOwnedResource,
  createOwnedResource,
  createRuntimeContext,
  makeOwnedHandle,
};
