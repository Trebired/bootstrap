import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { bootstrap, compareFiles, isAttachFile } from "../src/index";
import { resolveModuleHandler } from "../src/module/handler";

type LogRow = {
  level: string;
  group: string;
  message: string;
  data?: unknown;
};

function tempDir(): string {
  const parent = path.join(os.tmpdir(), "@trebired-bootstrap");
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, "test_"));
}

function writeModule(dir: string, rel: string, source: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, source);
}

function captureLogger() {
  const rows: LogRow[] = [];
  const push = (level: string, group: string, message: string, data?: unknown) => rows.push({ level, group, message, data });

  return {
    rows,
    logger: {
      info: (group: string, message: string, data?: unknown) => push("info", group, message, data),
      warn: (group: string, message: string, data?: unknown) => push("warn", group, message, data),
      error: (group: string, message: string, data?: unknown) => push("error", group, message, data),
      fail: (group: string, message: string, data?: unknown) => push("fail", group, message, data),
    },
  };
}

describe("@trebired/bootstrap", () => {
  test("detects attach files and sorts numeric suffixes before the last suffix", () => {
    expect(isAttachFile("connect.1.ts")).toBe(true);
    expect(isAttachFile("finish.z.ts", { lastSuffix: "z" })).toBe(true);
    expect(isAttachFile("plain.ts")).toBe(false);
    expect(isAttachFile("legacy.cjs")).toBe(false);
    expect(isAttachFile("types.d.ts", { excludeSuffixes: ["d"] })).toBe(false);

    const names = ["finish.z.ts", "connect.2.ts", "connect.1.ts"].sort((a, b) => compareFiles(a, b, { lastSuffix: "z" }));
    expect(names).toEqual(["connect.1.ts", "connect.2.ts", "finish.z.ts"]);
  });

  test("accepts ESM export shapes and rejects bare function module values", () => {
    expect(resolveModuleHandler({ attach() {} })?.exportShape).toBe("attach");
    expect(resolveModuleHandler({ default() {} })?.exportShape).toBe("function");
    expect(resolveModuleHandler(() => {})).toBeNull();
  });

  test("loads modules deterministically and resolves dependencies by parameter name", async () => {
    const dir = path.join(tempDir(), "src", "backend");
    const state = { events: [] as string[] };
    const { rows, logger } = captureLogger();

    writeModule(dir, "database/connect.2.ts", `
export default function connect(state) {
  state.events.push("2");
}
`);

    writeModule(dir, "database/connect.1.ts", `
export function attach(State) {
  State.events.push("1");
}
`);

    writeModule(dir, "database/routes.a.ts", `
export default {
  attach(dependencies) {
    dependencies.state.events.push("a");
  },
};
`);

    writeModule(dir, "database/ignored.ts", `
throw new Error("this file is not attachable");
`);

    const summary = await bootstrap({
      dir,
      logger,
      state,
    });

    expect(state.events).toEqual(["1", "2", "a"]);
    expect(summary).toEqual({ scanned: 4, loaded: 3, skipped: 0, failed: 0 });
    expect(rows[rows.length - 1]).toEqual({
      level: "info",
      group: "bootstrap",
      message: "scan-summary scanned=4 loaded=3 skipped=0 failed=0",
      data: undefined,
    });
  });

  test("supports grouped dir scanning rules and verbose skip logging", async () => {
    const dir = path.join(tempDir(), "src", "backend");
    const state = { events: [] as string[] };
    const { rows, logger } = captureLogger();

    writeModule(dir, "active/keep.1.ts", `
export default function keep(state) {
  state.events.push("keep");
}
`);

    writeModule(dir, "active/skip.spec.ts", `
throw new Error("spec files should be excluded");
`);

    writeModule(dir, "active/private/hidden.2.ts", `
export default function hidden(state) {
  state.events.push("hidden");
}
`);

    writeModule(dir, "jobs/run.2.ts", `
export default function run(state) {
  state.events.push("run");
}
`);

    writeModule(dir, "inactive/skip.1.ts", `
export default function skip(state) {
  state.events.push("skip");
}
`);

    const summary = await bootstrap({
      dir,
      scan: {
        dirs: {
          include: ["active", "jobs"],
          exclude: ["active/private"],
        },
        files: {
          excludeSuffixes: ["spec"],
        },
      },
      verbose: true,
      logger,
      state,
    });

    expect(state.events).toEqual(["keep", "run"]);
    expect(summary).toEqual({ scanned: 2, loaded: 2, skipped: 0, failed: 0 });
    expect(rows.some((row) => row.message.includes("excluded-dir:hidden.2.ts"))).toBe(false);
    expect(rows.some((row) => row.message.includes("excluded-dir:private"))).toBe(true);
    expect(rows.some((row) => row.message.includes("excluded-file:skip.spec.ts"))).toBe(true);
  });

  test("excludes node_modules by default and only scans it with an explicit flag", async () => {
    const dir = path.join(tempDir(), "src", "backend");
    const defaultState = { events: [] as string[] };
    const allowedState = { events: [] as string[] };

    writeModule(dir, "active/keep.1.ts", `
export default function keep(state) {
  state.events.push("keep");
}
`);

    writeModule(dir, "active/node_modules/hidden.2.ts", `
export default function hidden(state) {
  state.events.push("hidden");
}
`);

    const defaultSummary = await bootstrap({
      dir,
      state: defaultState,
    });

    const allowedSummary = await bootstrap({
      dir,
      state: allowedState,
      scan: {
        dirs: {
          allowNodeModules: true,
        },
      },
    });

    expect(defaultState.events).toEqual(["keep"]);
    expect(defaultSummary).toEqual({ scanned: 1, loaded: 1, skipped: 0, failed: 0 });
    expect(allowedState.events).toEqual(["keep", "hidden"]);
    expect(allowedSummary).toEqual({ scanned: 2, loaded: 2, skipped: 0, failed: 0 });
  });

  test("supports file include and exclude rules by basename and relative path", async () => {
    const dir = path.join(tempDir(), "src", "backend");
    const state = { events: [] as string[] };

    writeModule(dir, "http/keep.1.ts", `
export default function keep(state) {
  state.events.push("http-keep");
}
`);

    writeModule(dir, "http/special.2.ts", `
export default function special(state) {
  state.events.push("http-special");
}
`);

    writeModule(dir, "http/drop.3.ts", `
export default function drop(state) {
  state.events.push("http-drop");
}
`);

    writeModule(dir, "jobs/keep.1.ts", `
export default function keep(state) {
  state.events.push("jobs-keep");
}
`);

    writeModule(dir, "jobs/extra.a.ts", `
export default function extra(state) {
  state.events.push("jobs-extra");
}
`);

    const summary = await bootstrap({
      dir,
      state,
      scan: {
        files: {
          include: ["keep.1.ts", "http/special.2.ts", "jobs/extra.a.ts", "drop.3.ts"],
          exclude: ["jobs/keep.1.ts", "drop.3.ts"],
          lastSuffix: "a",
        },
      },
    });

    expect(state.events).toEqual(["http-keep", "http-special", "jobs-extra"]);
    expect(summary).toEqual({ scanned: 3, loaded: 3, skipped: 0, failed: 0 });
  });

  test("has no hardcoded dependency names and injects whatever names you pass", async () => {
    const dir = path.join(tempDir(), "src", "backend");
    const app = { events: [] as string[] };
    const server = { name: "srv" };
    const io = { name: "io" };
    const rocket = { name: "rocket" };
    const banana = { name: "banana" };

    writeModule(dir, "service/start.1.ts", `
export default function start(server, io, app) {
  app.events.push(server.name + "-" + io.name);
}
`);

    writeModule(dir, "service/custom.2.ts", `
export default function custom(rocket, banana, app) {
  app.events.push(rocket.name + "-" + banana.name);
}
`);

    const summary = await bootstrap({
      dir,
      app,
      server,
      io,
      rocket,
      banana,
    });

    expect(app.events).toEqual(["srv-io", "rocket-banana"]);
    expect(summary).toEqual({ scanned: 2, loaded: 2, skipped: 0, failed: 0 });
  });

  test("falls back to console when no logger is provided", async () => {
    const dir = path.join(tempDir(), "src", "backend");
    const state = { events: [] as string[] };
    const infoRows: unknown[][] = [];
    const warnRows: unknown[][] = [];
    const errorRows: unknown[][] = [];

    writeModule(dir, "active/keep.1.ts", `
export default function keep(state) {
  state.events.push("keep");
}
`);

    const originalInfo = console.info;
    const originalWarn = console.warn;
    const originalError = console.error;

    try {
      console.info = (...args: unknown[]) => {
        infoRows.push(args);
      };
      console.warn = (...args: unknown[]) => {
        warnRows.push(args);
      };
      console.error = (...args: unknown[]) => {
        errorRows.push(args);
      };

      const summary = await bootstrap({
        dir,
        state,
        verbose: true,
      });

      expect(summary).toEqual({ scanned: 1, loaded: 1, skipped: 0, failed: 0 });
      expect(state.events).toEqual(["keep"]);
    } finally {
      console.info = originalInfo;
      console.warn = originalWarn;
      console.error = originalError;
    }

    expect(warnRows).toEqual([]);
    expect(errorRows).toEqual([]);
    expect(infoRows.some((args) => String(args[0]).includes("[bootstrap] load :: active/keep.1.ts"))).toBe(true);
    expect(infoRows.some((args) => String(args[0]).includes("[bootstrap] scan-summary scanned=1 loaded=1 skipped=0 failed=0"))).toBe(true);
  });

  test("throws a clear bootstrap error when dir is missing", async () => {
    const { rows, logger } = captureLogger();

    await expect(bootstrap({ logger } as any)).rejects.toThrow("bootstrap-missing-dir");
    expect(rows[0]).toEqual({
      level: "fail",
      group: "bootstrap",
      message: "missing-dir",
      data: undefined,
    });
  });
});
