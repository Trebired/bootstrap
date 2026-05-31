import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

function captureEventSink() {
  const rows: Array<{ group: string; level: string; message: string; metadata?: unknown; timestamp?: string }> = [];
  return {
    logger(event: { group: string; level: string; message: string; metadata?: unknown; timestamp?: string }) {
      rows.push(event);
    },
    rows,
  };
}

export { captureEventSink, captureLogger, tempDir, writeModule };
export type { LogRow };
