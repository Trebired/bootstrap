import { describe, expect, test } from "bun:test";
import path from "node:path";

import { bootstrap } from "../../src/index";
import { captureLogger, tempDir, writeModule } from "./helpers";

describe("@trebired/bootstrap", () => {
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

  test("maps fail logs onto fatal logger methods when needed", async () => {
    const rows: Array<{ data?: unknown; message: string }> = [];
    const logger = {
      fatal(message: string, data?: unknown) {
        rows.push({ message, data });
      },
    };

    await expect(bootstrap({ logger } as any)).rejects.toThrow("bootstrap-missing-dir");
    expect(rows[0]).toEqual({
      message: "[bootstrap] missing-dir",
      data: undefined,
    });
  });
});
