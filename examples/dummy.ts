import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { bootstrap } from "#7l8fl6xuos5s";

type DemoLogger = {
  info(group: string, message: string, data?: unknown): void;
  warn(group: string, message: string, data?: unknown): void;
  error(group: string, message: string, data?: unknown): void;
  fail(group: string, message: string, data?: unknown): void;
};

const rootDir = path.join(os.tmpdir(), "@trebired-bootstrap", "dummy");
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

function createConsoleLogger(): DemoLogger {
  const write = (level: string, group: string, message: string, data?: unknown) => {
    const suffix = data === undefined ? "" : ` ${JSON.stringify(data)}`;
    process.stdout.write(`[${level}] ${group} ${message}${suffix}\n`);
  };

  return {
    info: (group, message, data) => write("info", group, message, data),
    warn: (group, message, data) => write("warn", group, message, data),
    error: (group, message, data) => write("error", group, message, data),
    fail: (group, message, data) => write("fail", group, message, data),
  };
}

async function runDummySystem(): Promise<void> {
  resetDemoProject();

  const state = { events: [] as string[] };
  const summary = await bootstrap({
    dir,
    verbose: true,
    logger: createConsoleLogger(),
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

  process.stdout.write(`${JSON.stringify({ rootDir, summary, events: state.events }, null, 2)}\n`);
}

runDummySystem().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
