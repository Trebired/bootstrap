import { describe, expect, test } from "bun:test";

import { createBootstrap } from "../../src/index";
import { tempDir, writeModule } from "./helpers";
import path from "node:path";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("@trebired/bootstrap lifecycle", () => {
  test("boots and shuts down subsystems in dependency-safe order", async () => {
    const calls: string[] = [];

    const runtime = createBootstrap({
      subsystems: [
        {
          id: "db",
          async bootstrap(context) {
            calls.push("bootstrap:db");
            context.addCleanup(async () => {
              calls.push("cleanup:db");
            }, { name: "db-cleanup" });
          },
          async shutdown() {
            calls.push("shutdown:db");
          },
        },
        {
          id: "http",
          dependsOn: ["db"],
          async bootstrap(context) {
            calls.push("bootstrap:http");
            context.addCleanup(async () => {
              calls.push("cleanup:http");
            }, { name: "http-cleanup" });
          },
          async shutdown() {
            calls.push("shutdown:http");
          },
        },
        {
          id: "worker",
          dependsOn: ["http"],
          async bootstrap(context) {
            calls.push("bootstrap:worker");
            context.addCleanup(async () => {
              calls.push("cleanup:worker");
            }, { name: "worker-cleanup" });
          },
          async shutdown() {
            calls.push("shutdown:worker");
          },
        },
      ],
    });

    const bootReport = await runtime.bootstrap();
    const shutdownReport = await runtime.shutdown({ reason: "test" });

    expect(bootReport.state).toBe("ready");
    expect(bootReport.startedSubsystems).toEqual(["db", "http", "worker"]);
    expect(calls).toEqual([
      "bootstrap:db",
      "bootstrap:http",
      "bootstrap:worker",
      "shutdown:worker",
      "cleanup:worker",
      "shutdown:http",
      "cleanup:http",
      "shutdown:db",
      "cleanup:db",
    ]);
    expect(shutdownReport.completed).toEqual([
      "shutdown:worker:worker",
      "cleanup:worker:worker-cleanup",
      "shutdown:http:http",
      "cleanup:http:http-cleanup",
      "shutdown:db:db",
      "cleanup:db:db-cleanup",
    ]);
  });

  test("supports graceful degradation before shutdown", async () => {
    const calls: string[] = [];

    const runtime = createBootstrap({
      subsystems: [
        {
          id: "http",
          async degrade() {
            calls.push("degrade:http");
          },
          async shutdown() {
            calls.push("shutdown:http");
          },
        },
      ],
    });

    await runtime.bootstrap();
    const degradeReport = await runtime.degrade({ reason: "drain" });
    const snapshot = runtime.getSnapshot();
    await runtime.shutdown({ reason: "stop" });

    expect(degradeReport.state).toBe("degrading");
    expect(snapshot.state).toBe("degrading");
    expect(snapshot.readiness).toBe(false);
    expect(snapshot.availability).toBe(false);
    expect(calls).toEqual(["degrade:http", "shutdown:http"]);
  });

  test("waits for async teardown hooks and owned cleanups", async () => {
    const calls: string[] = [];

    const runtime = createBootstrap({
      subsystems: [
        {
          id: "jobs",
          async bootstrap(context) {
            context.addCleanup(async () => {
              await delay(20);
              calls.push("cleanup:jobs");
            }, { name: "jobs-cleanup" });
          },
          async shutdown() {
            await delay(10);
            calls.push("shutdown:jobs");
          },
        },
      ],
    });

    await runtime.bootstrap();
    const report = await runtime.shutdown({ timeoutMs: 200 });

    expect(calls).toEqual(["shutdown:jobs", "cleanup:jobs"]);
    expect(report.failed).toEqual([]);
    expect(report.timedOut).toEqual([]);
  });

  test("supports lifecycle-aware scanned modules alongside the existing scan model", async () => {
    const dir = path.join(tempDir(), "src", "backend");
    const state = { events: [] as string[] };

    writeModule(dir, "db/connect.1.ts", `
export default {
  id: "db",
  async bootstrap(context) {
    context.deps.state.events.push("bootstrap:db");
    context.addCleanup(async () => {
      context.deps.state.events.push("cleanup:db");
    }, { name: "db-cleanup" });
  },
  async shutdown(context) {
    context.deps.state.events.push("shutdown:db");
  },
};
`);

    writeModule(dir, "http/server.2.ts", `
export const subsystem = {
  id: "http",
  dependsOn: ["db"],
  async bootstrap(context) {
    context.deps.state.events.push("bootstrap:http");
  },
  async shutdown(context) {
    context.deps.state.events.push("shutdown:http");
  },
};
`);

    const runtime = createBootstrap({
      dir,
      state,
    });

    const bootReport = await runtime.bootstrap();
    await runtime.shutdown({ reason: "scan" });

    expect(bootReport.startedSubsystems).toEqual(["db", "http"]);
    expect(state.events).toEqual([
      "bootstrap:db",
      "bootstrap:http",
      "shutdown:http",
      "shutdown:db",
      "cleanup:db",
    ]);
  });

  test("forces cleanup after timeout and reports the forced step", async () => {
    const calls: string[] = [];

    const runtime = createBootstrap({
      lifecycle: {
        shutdownTimeoutMs: 30,
      },
      subsystems: [
        {
          id: "hung-worker",
          async bootstrap(context) {
            context.own(
              {
                async close() {
                  calls.push("close:hung-worker");
                  await new Promise(() => undefined);
                },
                async destroy() {
                  calls.push("destroy:hung-worker");
                },
              },
              { name: "hung-resource" },
            );
          },
        },
      ],
    });

    await runtime.bootstrap();
    const report = await runtime.shutdown({ reason: "timeout" });

    expect(calls).toEqual(["close:hung-worker", "destroy:hung-worker"]);
    expect(report.forced).toEqual(["cleanup:hung-worker:hung-resource"]);
    expect(report.timedOut).toEqual([]);
  });

  test("returns the same shutdown result on repeated calls and only runs teardown once", async () => {
    let shutdownCalls = 0;

    const runtime = createBootstrap({
      subsystems: [
        {
          id: "api",
          async shutdown() {
            shutdownCalls += 1;
            await delay(10);
          },
        },
      ],
    });

    await runtime.bootstrap();
    const [first, second] = await Promise.all([
      runtime.shutdown({ reason: "repeat" }),
      runtime.shutdown({ reason: "repeat" }),
    ]);

    expect(shutdownCalls).toBe(1);
    expect(first).toEqual(second);
  });

  test("cleans up started subsystems when a later bootstrap hook fails", async () => {
    const calls: string[] = [];

    const runtime = createBootstrap({
      subsystems: [
        {
          id: "db",
          async bootstrap(context) {
            calls.push("bootstrap:db");
            context.addCleanup(async () => {
              calls.push("cleanup:db");
            }, { name: "db-cleanup" });
          },
          async shutdown() {
            calls.push("shutdown:db");
          },
        },
        {
          id: "http",
          dependsOn: ["db"],
          async bootstrap() {
            calls.push("bootstrap:http");
            throw new Error("boom");
          },
        },
      ],
    });

    await expect(runtime.bootstrap()).rejects.toThrow("bootstrap-subsystem-failed:http");

    expect(runtime.getState()).toBe("stopped");
    expect(calls).toEqual([
      "bootstrap:db",
      "bootstrap:http",
      "shutdown:db",
      "cleanup:db",
    ]);
  });

  test("emits structured lifecycle events", async () => {
    const events: string[] = [];

    const runtime = createBootstrap({
      lifecycle: {
        onEvent(event) {
          events.push(event.type);
        },
      },
      subsystems: [
        {
          id: "api",
          async shutdown() {},
        },
      ],
    });

    await runtime.bootstrap();
    await runtime.shutdown({ reason: "events" });

    expect(events).toContain("bootstrap:start");
    expect(events).toContain("bootstrap:finish");
    expect(events).toContain("readiness:enabled");
    expect(events).toContain("shutdown:requested");
    expect(events).toContain("hook:start");
    expect(events).toContain("hook:finish");
    expect(events).toContain("shutdown:finish");
  });
});
