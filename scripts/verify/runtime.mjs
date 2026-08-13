import assert from "node:assert/strict";

import {
  bindBootstrapShutdownSignals,
  createBootstrap,
  createBootstrapShutdownController,
} from "../../dist/index.js";

async function main() {
  await verifyLifecycleLogger();
  await verifyShutdownController();
  await verifySignalBinding();
  await verifyDisposableCleanup();
  console.log("Runtime verification succeeded.");
}

async function verifyLifecycleLogger() {
  const logs = [];
  const runtime = createBootstrap({
      logger: (event) => logs.push(event),
      subsystems: [
        {
          id: "service",
          bootstrap() {},
        },
      ],
  });

  await runtime.bootstrap();
  await runtime.degrade({ reason: "verify" });

  const start = logs.find((event) => event.message === "bootstrap:start");
  const disabled = logs.find((event) => event.message === "readiness:disabled");
  const finish = logs.find((event) => event.message === "bootstrap:finish");
  assert.equal(start.group, "trebired.bootstrap.lifecycle");
  assert.equal(disabled.group, "trebired.bootstrap.lifecycle");
  assert.equal(finish.group, "trebired.bootstrap.lifecycle");
  assert.equal(disabled.metadata.reason, "verify");
}

async function verifyShutdownController() {
  const logs = [];
  let degradeCalls = 0;
  let shutdownCalls = 0;
  const terminateCalls = [];
  const runtime = createBootstrap({
      logger: () => {},
      subsystems: [
        {
          id: "service",
          bootstrap() {},
          degrade() {
            degradeCalls += 1;
          },
          shutdown() {
            shutdownCalls += 1;
          },
        },
      ],
  });

  await runtime.bootstrap();
  const controller = createBootstrapShutdownController(runtime, {
      logger: (event) => logs.push(event),
      terminate: (exitCode) => terminateCalls.push(exitCode),
      timeoutMs: 200,
  });
  const first = controller.request({ exitCode: 3, reason: "manual" });
  const second = controller.request({ exitCode: 4, reason: "ignored" });
  const result = await first;

  assert.equal(first, second);
  assert.equal(result.exitCode, 3);
  assert.equal(result.reason, "manual");
  assert.equal(result.terminated, true);
  assert.deepEqual(terminateCalls, [3]);
  assert.equal(degradeCalls, 1);
  assert.equal(shutdownCalls, 1);
  assert.equal(logs.find((event) => event.message === "shutdown:requested").group, "trebired.bootstrap.shutdown");
  assert.equal((await controller.request()).exitCode, 3);

  await verifyShutdownControllerFailureLogging();
}

async function verifyShutdownControllerFailureLogging() {
  const logs = [];
  const degradeError = new Error("degrade failed");
  const shutdownError = new Error("shutdown failed");
  const controller = createBootstrapShutdownController({
      async degrade() {
        throw degradeError;
      },
      async shutdown() {
        throw shutdownError;
      },
    }, {
      logger: (event) => logs.push(event),
  });
  const result = await controller.request({ reason: "failure" });

  assert.equal(result.degradeError, degradeError);
  assert.equal(result.shutdownError, shutdownError);
  assert.ok(logs.some((event) => event.message === "shutdown:degrade-failure"));
  assert.ok(logs.some((event) => event.message === "shutdown:failure"));
}

async function verifySignalBinding() {
  const calls = [];
  const handlers = {};
  const cleanups = [];
  const cleanup = bindBootstrapShutdownSignals({
      request: (options) => {
        calls.push(options);
        return Promise.resolve({ exitCode: options.exitCode, terminated: false });
      },
    }, {
      exitCode: 2,
      once(signal, handler) {
        handlers[signal] = handler;
        return () => cleanups.push(signal);
      },
      reason: (signal) => `signal:${signal}`,
      signals: ["ONE", "TWO"],
  });

  handlers.ONE();
  await Promise.resolve();
  cleanup();

  assert.deepEqual(calls, [{ exitCode: 2, reason: "signal:ONE" }]);
  assert.deepEqual(cleanups, ["TWO", "ONE"]);
}

async function verifyDisposableCleanup() {
  await verifyCloseCleanup((markClosed) => () => markClosed());
  await verifyCloseCleanup((markClosed) => async() => markClosed());
  await verifyCallbackCleanupSuccess();
  await verifyCallbackCleanupError();
  await verifyCallbackCleanupForce();
}

async function verifyCloseCleanup(createClose) {
  let closed = false;
  const report = await shutdownResource({
      close: createClose(() => {
          closed = true;
      }),
  });
  assert.equal(closed, true);
  assert.equal(report.completed.length, 1);
}

async function verifyCallbackCleanupSuccess() {
  let closeCallback;
  let completed = false;
  const runtime = createResourceRuntime({
      close(callback) {
        closeCallback = callback;
      },
  });
  await runtime.bootstrap();
  const shutdown = runtime.shutdown({ timeoutMs: 500 }).then((report) => {
      completed = true;
      return report;
  });

  await waitFor(() => typeof closeCallback === "function");
  assert.equal(completed, false);
  closeCallback();
  const report = await shutdown;
  assert.equal(completed, true);
  assert.equal(report.completed.length, 1);
}

async function verifyCallbackCleanupError() {
  const cleanupError = new Error("close failed");
  const report = await shutdownResource({
      close(callback) {
        callback(cleanupError);
      },
  });
  assert.equal(report.failed.length, 1);
  assert.equal(report.steps[0].error, cleanupError);
}

async function verifyCallbackCleanupForce() {
  let forced = false;
  const report = await shutdownResource({
      close(_callback) {},
      destroy() {
        forced = true;
      },
    }, { timeoutMs: 5 });
  assert.equal(forced, true);
  assert.equal(report.forced.length, 1);
}

async function shutdownResource(resource, options = {}) {
  const runtime = createResourceRuntime(resource);
  await runtime.bootstrap();
  return runtime.shutdown(options);
}

function createResourceRuntime(resource) {
  return createBootstrap({
      logger: () => {},
      subsystems: [
        {
          id: "resource",
          bootstrap(context) {
            context.own(resource, { name: "resource" });
          },
        },
      ],
  });
}

async function waitFor(condition) {
  for (let index = 0; index < 20; index += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("verify-timeout");
}

await main();
