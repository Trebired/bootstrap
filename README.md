# @trebired/bootstrap

`@trebired/bootstrap` is a generic application lifecycle orchestrator for Bun.

It still supports the original ordered startup scan model through `bootstrap()`, and now also provides a first-class runtime API through `createBootstrap()` so applications can:

- bring subsystems up in a safe order
- mark themselves ready
- degrade readiness and availability before shutdown
- stop background activity
- tear down owned resources in reverse dependency order
- shut down cleanly without depending on process exit

The package stays framework-agnostic. It does not assume HTTP, queues, workers, or a specific server runtime.

## Install

Runtime support: Bun 1+.

```sh
bun i @trebired/bootstrap
```

## Quick Start

Use `bootstrap()` when you want the existing one-shot startup behavior:

```ts
import { bootstrap } from "@trebired/bootstrap";

await bootstrap({
  dir: "/srv/app/src/backend",
  config,
  db,
  log,
  logger: log,
});
```

Use `createBootstrap()` when you want a stateful lifecycle runtime with graceful degradation and shutdown:

```ts
import { createBootstrap } from "@trebired/bootstrap";

const runtime = createBootstrap({
  lifecycle: {
    shutdownTimeoutMs: 10_000,
  },
  subsystems: [
    {
      id: "db",
      async bootstrap(context) {
        const connection = await connectDatabase(context.deps.config.databaseUrl);
        context.own(connection, { name: "db-connection" });
      },
    },
    {
      id: "http",
      dependsOn: ["db"],
      async bootstrap(context) {
        const server = context.deps.http.createServer(context.deps.app);
        await new Promise((resolve) => server.listen(3000, resolve));
        context.own(server, { name: "http-server" });
      },
      async degrade(context) {
        context.readiness.disable("draining");
        context.availability.disable("draining");
      },
      async shutdown() {
        // Optional subsystem-specific shutdown logic before owned resources close.
      },
    },
  ],
  config,
  http,
  app,
});

await runtime.bootstrap();
await runtime.degrade({ reason: "deployment" });
await runtime.shutdown({ reason: "deployment" });
```

## Concepts

### Lifecycle Model

The runtime exposes explicit lifecycle states:

- `idle`
- `bootstrapping`
- `ready`
- `degrading`
- `shutting_down`
- `stopped`
- `failed`

Readiness and availability are tracked separately from the state machine, so an application can become unavailable before it fully stops.

Common flow:

1. `idle`
2. `bootstrapping`
3. `ready`
4. `degrading`
5. `shutting_down`
6. `stopped`

If startup fails after some subsystems already started, the runtime moves through `failed` and then cleans up what was already started.

### Programmatic Subsystems

Startup and teardown belong to the same subsystem definition:

```ts
import { createBootstrap } from "@trebired/bootstrap";

const runtime = createBootstrap({
  subsystems: [
    {
      id: "metrics",
      async bootstrap(context) {
        const interval = setInterval(flushMetrics, 5_000);
        context.own(
          {
            stop() {
              clearInterval(interval);
            },
          },
          { name: "metrics-interval" },
        );
      },
      async shutdown() {
        await flushMetrics();
      },
    },
  ],
});
```

Subsystem fields:

- `id`: required stable identifier
- `dependsOn`: optional dependency list used for ordered startup and reverse-order shutdown
- `bootstrap(context)`: startup hook
- `degrade(context)`: optional pre-shutdown degradation hook
- `shutdown(context)`: optional teardown hook
- `order`: optional numeric tie-breaker when no dependency relationship exists

### Graceful Degradation

Applications often need to stop accepting new work before they fully shut down.

`degrade()` is the explicit transition for that:

```ts
await runtime.degrade({ reason: "rolling-update" });
```

That lets your app:

- fail readiness checks
- mark itself unavailable
- reject new work
- drain in-flight work in your own subsystem hooks

The library stays generic: it tracks readiness and availability, emits lifecycle events, and leaves health endpoints, request rejection, and drain semantics to your application code.

Inside subsystem hooks you can control readiness directly:

```ts
{
  id: "http",
  async degrade(context) {
    context.readiness.disable("draining");
    context.availability.disable("draining");
    await stopAcceptingNewRequests();
    await drainInflightRequests();
  },
}
```

### Shutdown Timeouts And Forced Teardown

Set a default timeout for the runtime:

```ts
const runtime = createBootstrap({
  lifecycle: {
    shutdownTimeoutMs: 15_000,
  },
  subsystems: [...],
});
```

Or override it for a single shutdown call:

```ts
await runtime.shutdown({
  reason: "sigterm",
  timeoutMs: 5_000,
});
```

If cleanup runs past the timeout:

- the report marks the step as `timed_out`
- if a force cleanup handler exists, the step is reported as `forced`
- a `shutdown:forced` lifecycle event is emitted

This makes it clear what stopped cleanly and what had to be forced.

### Structured Lifecycle Events

Subscribe to lifecycle events through `runtime.onEvent(...)` or `lifecycle.onEvent` in the constructor.

The runtime emits structured events for:

- bootstrap start, finish, and failure
- readiness enabled and disabled
- shutdown requested
- hook start, finish, and failure
- forced shutdown
- final stopped state

Bootstrap logs lifecycle events as package logs through the logger adapter. `lifecycle.onEvent` is only for app-specific observers.

### Shutdown Controller

Use `createBootstrapShutdownController()` when a host needs one place to request graceful shutdown, log the request, and optionally terminate after lifecycle attempts complete:

```ts
import { createBootstrapShutdownController } from "@trebired/bootstrap";

const shutdown = createBootstrapShutdownController(runtime, {
  logger,
  timeoutMs: 8_000,
  defaultExitCode: 0,
  terminate(exitCode) {
    process.exit(exitCode);
  },
});

await shutdown.request({
  reason: "signal:SIGTERM",
  exitCode: 0,
});
```

Shutdown requests are idempotent. Repeated calls while a request is in flight return the same work, and later calls safely return the completed result. The controller calls `runtime.degrade({ reason })` and then `runtime.shutdown({ reason, timeoutMs })`, logs degrade and shutdown failures separately when a logger is provided, and never imports or depends on Node process globals.

Bind signals through injected registration:

```ts
const unbindSignals = shutdown.bindSignals({
  signals: ["SIGINT", "SIGTERM", "SIGHUP"],
  once: (signal, handler) => process.once(signal, handler),
  reason: (signal) => `signal:${signal}`,
  exitCode: 0,
});

unbindSignals();
```

`bindBootstrapShutdownSignals()` is also exported when a caller wants the binding helper separate from the controller instance.

### Directory Scan Mode

The original directory-based startup loader remains intact.

`bootstrap()` still:

- scans first-level child directories under `dir`
- walks them recursively
- loads only `.js`, `.mjs`, `.ts`, and `.mts`
- runs only ordered files like `.1`, `.2`, and the final suffix such as `.a`
- injects non-option top-level keys by parameter name

Example:

```ts
await bootstrap({
  dir: "/srv/app/src/backend",
  config,
  db,
  log,
  logger: log,
  scan: {
    dirs: {
      include: ["db", "http", "jobs"],
      exclude: ["legacy", "db/fixtures"],
    },
    files: {
      excludeSuffixes: ["spec", "test", "d"],
      lastSuffix: "a",
    },
  },
});
```

Reserved option keys are:

- `dir`
- `scan`
- `verbose`
- `logger`
- `loggerAdapter`
- `lifecycle`
- `subsystems`

Everything else remains injectable as a dependency.

### Lifecycle-Aware Scanned Modules

Scanned modules can stay in the old attach-function form, or they can use the newer subsystem model.

Example scanned subsystem module:

```ts
export default {
  id: "http",
  dependsOn: ["db"],
  async bootstrap(context) {
    const server = context.deps.http.createServer(context.deps.app);
    await new Promise((resolve) => server.listen(3000, resolve));
    context.own(server, { name: "http-server" });
  },
  async degrade(context) {
    context.readiness.disable("draining");
    context.availability.disable("draining");
  },
  async shutdown() {
    await flushPendingLogs();
  },
};
```

or:

```ts
export const subsystem = {
  id: "jobs",
  async bootstrap(context) {
    const consumer = startQueueConsumer();
    context.own(consumer, { name: "queue-consumer" });
  },
  async shutdown() {
    await drainQueue();
  },
};
```

These scanned subsystem modules work with `createBootstrap({ dir, ...deps })`.

## Runtime

### Owned Resources And Disposables

Bootstrap contexts make cleanup registration explicit and local to the subsystem that created the resource.

Use `context.own(...)` for a disposable object:

```ts
{
  id: "worker",
  async bootstrap(context) {
    const worker = startBackgroundWorker();
    context.own(worker, { name: "jobs-worker" });
  },
}
```

Recognized cleanup methods include:

- `dispose()`
- `close()`
- `stop()`
- `terminate()`
- `disconnect()`
- `destroy()`
- `abort()`
- `kill()`

Cleanup methods may be synchronous, promise-returning, or Node-style callback methods:

```ts
context.own(server, { name: "server" });
```

For a resource like `server.close(callback)`, shutdown waits until the callback fires. If the callback receives an error, the cleanup step is reported as failed.

Use `context.addCleanup(...)` for plain functions:

```ts
{
  id: "watcher",
  async bootstrap(context) {
    const stopWatching = startFileWatcher();
    context.addCleanup(stopWatching, { name: "file-watcher" });
  },
}
```

You can also override both graceful and forced cleanup behavior:

```ts
context.own(server, {
  name: "http-server",
  cleanup: async (value) => {
    await closeServerGracefully(value as Server);
  },
  forceCleanup: async (value) => {
    await destroyServerHard(value as Server);
  },
});
```

Owned resources are cleaned up after the subsystem's `shutdown()` hook, in reverse registration order.

### Logger Support

`logger` and `loggerAdapter` still behave the same as before for bootstrap's own logging.

The runtime also emits structured lifecycle events through `onEvent`, which is the preferred observability surface for orchestration state.

### Example Files

Examples live under [examples](./examples):

- [examples/dummy.ts](./examples/dummy.ts)
- [examples/lifecycle.ts](./examples/lifecycle.ts)
- [examples/server.js](./examples/server.js)

## Public API

### Runtime API

```ts
import { createBootstrap } from "@trebired/bootstrap";

const runtime = createBootstrap(options);
```

Runtime methods:

- `runtime.registerSubsystem(subsystem)`
- `runtime.bootstrap()`
- `runtime.degrade({ reason? })`
- `runtime.shutdown({ reason?, timeoutMs? })`
- `runtime.getState()`
- `runtime.getSnapshot()`
- `runtime.isReady()`
- `runtime.isAvailable()`
- `runtime.onEvent(listener)`

`bootstrap()` on the runtime returns a structured report:

```ts
type BootstrapRunReport = {
  state: "ready" | "degrading";
  readiness: boolean;
  availability: boolean;
  summary: {
    scanned: number;
    loaded: number;
    skipped: number;
    failed: number;
  };
  startedSubsystems: string[];
  failedSubsystems: string[];
};
```

`shutdown()` returns a structured teardown report:

```ts
type BootstrapShutdownReport = {
  state: "stopped";
  timeoutMs: number | null;
  reason?: string;
  steps: Array<{
    target: "subsystem" | "resource";
    phase: "degrade" | "shutdown" | "cleanup";
    subsystemId: string;
    name: string;
    status: "completed" | "failed" | "timed_out" | "forced";
    durationMs: number;
    error?: unknown;
  }>;
  completed: string[];
  failed: string[];
  timedOut: string[];
  forced: string[];
};
```

Repeated shutdown calls are safe and idempotent. If shutdown is already in progress, callers get the same in-flight result.

## Migration Notes

### Legacy Compatibility

Existing bootstrap-only consumers keep working:

- `bootstrap(options)` still returns the original summary object
- attach-style scanned modules still work
- dependency injection by parameter name is unchanged
- scan rules and logger behavior stay available

If you only need one-shot startup, nothing has to change.

## What It Does Not Do

This package does not:

- assume HTTP, queue, worker, or process-exit ownership
- hide subsystem order or resource teardown behind globals
- build an application-specific subsystem graph
