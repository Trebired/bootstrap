import { createBootstrap } from "#7l8fl6xuos5s";

type FakeServer = {
  listen: () => Promise<void>;
  close: () => Promise<void>;
  destroy: () => Promise<void>;
};

function makeServer(): FakeServer {
  return {
    async listen() {
      console.info("server listening");
    },
    async close() {
      console.info("server closed");
    },
    async destroy() {
      console.info("server destroyed");
    },
  };
}

async function main(): Promise<void> {
  const runtime = createBootstrap({
    lifecycle: {
      shutdownTimeoutMs: 5_000,
      onEvent(event) {
        console.info("lifecycle", event.type, event.state, event.subsystemId || "-");
      },
    },
    subsystems: [
      {
        id: "config",
        async bootstrap() {
          console.info("config loaded");
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
            cleanup: async (value) => {
              await (value as FakeServer).close();
            },
            forceCleanup: async (value) => {
              await (value as FakeServer).destroy();
            },
          });
        },
        async degrade(context) {
          context.readiness.disable("draining");
          context.availability.disable("draining");
          console.info("http draining");
        },
        async shutdown() {
          console.info("http shutdown hook");
        },
      },
    ],
  });

  await runtime.bootstrap();
  await runtime.degrade({ reason: "demo" });
  await runtime.shutdown({ reason: "demo" });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
