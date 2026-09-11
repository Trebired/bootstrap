import { createBootstrap } from "#7l8fl6xuos5s";
import { resolveLogger } from "@package/logger-adapter";

const log = resolveLogger({ source: "@trebired/bootstrap" });

type FakeServer = {
  listen: () => Promise<void>;
  close: () => Promise<void>;
  destroy: () => Promise<void>;
};

function makeServer(): FakeServer {
  return {
    async listen() {
      log.info("example.lifecycle", "server listening");
    },
    async close() {
      log.info("example.lifecycle", "server closed");
    },
    async destroy() {
      log.info("example.lifecycle", "server destroyed");
    },
  };
}

async function main(): Promise<void> {
  const runtime = createBootstrap({
      lifecycle: {
        shutdownTimeoutMs: 5_000,
        onEvent(event) {
          log.info("example.lifecycle", "lifecycle event", {
              type: event.type,
              state: event.state,
              subsystemId: event.subsystemId || "-",
          });
        },
      },
      subsystems: [
        {
          id: "config",
          async bootstrap() {
            log.info("example.lifecycle", "config loaded");
          },
        },
        {
          id: "http",
          dependsOn: ["config"],
          async bootstrap(context) {
            const server = makeServer();
            await server.listen();

            context.own(server, {
                name: "http-server",
                cleanup: async(value) => {
                  await (value as FakeServer).close();
                },
                forceCleanup: async(value) => {
                  await (value as FakeServer).destroy();
                },
            });
          },
          async degrade(context) {
            context.readiness.disable("draining");
            context.availability.disable("draining");
            log.info("example.lifecycle", "http draining");
          },
          async shutdown() {
            log.info("example.lifecycle", "http shutdown hook");
          },
        },
      ],
  });

  await runtime.bootstrap();
  await runtime.degrade({ reason: "demo" });
  await runtime.shutdown({ reason: "demo" });
}

main().catch ((error) => {
    log.error("example.lifecycle", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
