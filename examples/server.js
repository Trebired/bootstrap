import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bootstrap } from "#7l8fl6xuos5s";
import { resolveLogger } from "@package/logger-adapter";

const log = resolveLogger({ source: "@trebired/bootstrap" });

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "server_bootstrap");

const app = {
  routes: [],
  get(route, handler) {
    this.routes.push({ method: "GET", route, handler });
  },
  use(handler) {
    this.routes.push({ method: "USE", route: "*", handler });
  },
};

const serverState = {
  server: null,
};

await bootstrap({
    dir,
    config: {
      port: 3000,
      appName: "example-server",
    },
    app,
    http,
    log,
    scan: {
      dirs: {
        include: ["http"],
      },
      files: {
        excludeSuffixes: ["spec", "test", "d"],
        lastSuffix: "a",
      },
    },
    logger: log,
    serverState,
});

log.info("example.server", "bootstrap complete", {
    routes: app.routes.map((route) => `${route.method} ${route.route}`),
    listening: Boolean(serverState.server),
});
