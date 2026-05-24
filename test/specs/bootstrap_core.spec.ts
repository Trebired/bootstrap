import { describe, expect, test } from "bun:test";
import path from "node:path";

import { bootstrap, compareFiles, isAttachFile } from "../../src/index";
import { resolveModuleHandler } from "../../src/module/handler";
import { captureEventSink, captureLogger, tempDir, writeModule } from "./helpers";

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

  test("supports event-sink logger styles", async () => {
    const dir = path.join(tempDir(), "src", "backend");
    const state = { events: [] as string[] };
    const { rows, logger } = captureEventSink();

    writeModule(dir, "database/connect.1.ts", `
export default function connect(state) {
  state.events.push("1");
}
`);

    const summary = await bootstrap({
      dir,
      logger,
      state,
      verbose: true,
    });

    expect(summary).toEqual({ scanned: 1, loaded: 1, skipped: 0, failed: 0 });
    expect(state.events).toEqual(["1"]);
    expect(rows.some((entry) => entry.level === "info" && entry.group === "bootstrap" && entry.message === "load :: database/connect.1.ts")).toBe(true);
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
});
