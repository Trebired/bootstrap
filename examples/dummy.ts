import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { bootstrap } from "#7l8fl6xuos5s";
import { resolveLogger } from "@package/logger-adapter";

const log = resolveLogger({ source: "@trebired/bootstrap" });

const rootDir = path.join(os.tmpdir(), "@package-bootstrap", "dummy");
const dir = path.join(rootDir, "src", "backend");

function writeModule(rel: string, source: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, source);
}

function resetDemoProject(): void {
  fs.rmSync(rootDir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  writeModule("database/connect.1.ts", `
    export default function connect(config, state) {
    state.events.push("database connected to " + config.databaseUrl);
    }
  `);

  writeModule("database/migrate.2.ts", `
    export function attach(state) {
    state.events.push("database migrations complete");
    }
  `);

  writeModule("http/routes.a.ts", `
    export default {
    attach(dependencies) {
    dependencies.state.events.push("http routes attached for " + dependencies.config.serviceName);
    },
    };
  `);
}

async function runDummySystem(): Promise<void> {
  resetDemoProject();

  const state = { events: [] as string[] };
  const summary = await bootstrap({
      dir,
      verbose: true,
      logger: log,
      scan: {
        dirs: {
          include: ["database", "http"],
        },
        files: {
          excludeSuffixes: ["spec", "test", "d"],
          lastSuffix: "a",
        },
      },
      config: {
        databaseUrl: "postgres://demo.local/app",
        serviceName: "dummy",
      },
      state,
  });

  log.info("example.dummy", "summary", { rootDir, summary, events: state.events });
}

runDummySystem().catch ((error) => {
    log.error("example.dummy", error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
});
