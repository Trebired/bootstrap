import fs from "node:fs";
import path from "node:path";

function isDir(value: string): boolean {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function relFromRoot(value: string, root: string): string {
  try {
    return path.relative(root, value);
  } catch {
    return String(value || "");
  }
}

function stripComments(source: unknown): string {
  return String(source || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

function readFileCached(cache: Map<string, string | null>, fileAbs: string): string | null {
  const abs = path.resolve(fileAbs);
  if (cache.has(abs)) return cache.get(abs) ?? null;

  let source: string | null = null;
  try {
    source = fs.readFileSync(abs, "utf8");
  } catch {
    source = null;
  }

  const code = source ? stripComments(source) : null;
  cache.set(abs, code);
  return code;
}

export { isDir, readFileCached, relFromRoot, stripComments };
