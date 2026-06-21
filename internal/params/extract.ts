import type { BootstrapExportShape } from "#63np0sf1s6f9";

function getFnSource(fn: unknown): string {
  try {
    return typeof fn === "function" ? String(Function.prototype.toString.call(fn) || "") : "";
  } catch {
    return "";
  }
}

function splitParams(raw: unknown): string[] {
  const source = String(raw || "").trim();
  if (!source) return [];

  return source
    .split(",")
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .map((item) => String((item.split("=")[0] || "")).trim())
    .map((item) => {
      const token = String(item || "").trim().replace(/^\.\.\./, "").trim();
      const simple = token.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\??(?:\s*:\s*[\s\S]+)?$/);
      return simple && simple[1] ? simple[1] : token;
    })
    .filter(Boolean);
}

function parseParamTokensFromFn(fn: unknown): string[] {
  if (typeof fn !== "function") return [];

  const source = getFnSource(fn).trim();
  if (!source) return [];

  let inside = "";
  const arrowIdx = source.indexOf("=>");
  if (arrowIdx !== -1) {
    const left = source.slice(0, arrowIdx).trim();
    if (left.startsWith("(")) {
      const end = left.indexOf(")");
      if (end !== -1) inside = left.slice(1, end);
    } else {
      inside = left;
    }
  } else {
    const open = source.indexOf("(");
    if (open !== -1) {
      const close = source.indexOf(")", open + 1);
      if (close !== -1) inside = source.slice(open + 1, close);
    }
  }

  return splitParams(inside);
}

function isIdentifierToken(token: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token);
}

function escapeRegExp(value: string): string {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractParamsFromNamedFunction(code: string, fnName: string): string[] | null {
  const normalizedName = String(fnName || "").trim();
  if (!normalizedName) return null;

  const name = escapeRegExp(normalizedName);

  let match = code.match(new RegExp(`\\bfunction\\s+${name}\\s*\\(\\s*([^)]*)\\)`, "m"));
  if (match && match[1] != null) return splitParams(match[1]);

  match = code.match(
    new RegExp(
      `\\b(?:const|let|var)\\s+${name}\\s*=\\s*function(?:\\s+[A-Za-z_$][A-Za-z0-9_$]*)?\\s*\\(\\s*([^)]*)\\)`,
      "m",
    ),
  );
  if (match && match[1] != null) return splitParams(match[1]);

  match = code.match(new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*\\(\\s*([^)]*)\\)\\s*=>`, "m"));
  if (match && match[1] != null) return splitParams(match[1]);

  match = code.match(new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*([A-Za-z_$][A-Za-z0-9_$]*)\\s*=>`, "m"));
  if (match && match[1] != null) return [String(match[1]).trim()].filter(Boolean);

  return null;
}

function extractParamsFromExportedFunctionCode(code: string): string[] | null {
  let match = code.match(/\bexport\s+default\s+function(?:\s+[A-Za-z_$][A-Za-z0-9_$]*)?\s*\(\s*([^)]*)\)/m);
  if (match && match[1] != null) return splitParams(match[1]);

  match = code.match(/\bexport\s+default\s*\(\s*([^)]*)\)\s*=>/m);
  if (match && match[1] != null) return splitParams(match[1]);

  match = code.match(/\bexport\s+default\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=>/m);
  if (match && match[1] != null) return [String(match[1]).trim()].filter(Boolean);

  return null;
}

function extractExportedFnName(code: string): string {
  const match = code.match(/\bexport\s+default\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/m);
  return match && match[1] ? String(match[1]).trim() : "";
}

function extractAttachValueNameFromObjectExport(code: string): string {
  let match = code.match(/\bexport\s+default\s*\{[\s\S]*?\battach\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*)\b/m);
  if (match && match[1]) return String(match[1]).trim();

  match = code.match(/\bexport\s+default\s*\{[\s\S]*?\battach\s*,/m);
  if (match) return "attach";

  match = code.match(/\bexport\s+default\s*\{[\s\S]*?\battach\s*\}/m);
  if (match) return "attach";

  return "";
}

function extractParamsFromAttachExportCode(code: string): string[] | null {
  let match = code.match(/\bexport\s+function\s+attach\s*\(\s*([^)]*)\)/m);
  if (match && match[1] != null) return splitParams(match[1]);

  match = code.match(/\bexport\s+(?:const|let|var)\s+attach\s*=\s*function(?:\s+[A-Za-z_$][A-Za-z0-9_$]*)?\s*\(\s*([^)]*)\)/m);
  if (match && match[1] != null) return splitParams(match[1]);

  match = code.match(/\bexport\s+(?:const|let|var)\s+attach\s*=\s*\(\s*([^)]*)\)\s*=>/m);
  if (match && match[1] != null) return splitParams(match[1]);

  match = code.match(/\bexport\s+(?:const|let|var)\s+attach\s*=\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=>/m);
  if (match && match[1] != null) return [String(match[1]).trim()].filter(Boolean);

  match = code.match(/\bexport\s+default\s*\{[\s\S]*?\battach\s*:\s*function(?:\s+[A-Za-z_$][A-Za-z0-9_$]*)?\s*\(\s*([^)]*)\)/m);
  if (match && match[1] != null) return splitParams(match[1]);

  match = code.match(/\bexport\s+default\s*\{[\s\S]*?\battach\s*\(\s*([^)]*)\)\s*\{/m);
  if (match && match[1] != null) return splitParams(match[1]);

  match = code.match(/\bexport\s+default\s*\{[\s\S]*?\battach\s*:\s*\(\s*([^)]*)\)\s*=>/m);
  if (match && match[1] != null) return splitParams(match[1]);

  return null;
}

function extractParamsOverrideFromFile(args: {
  code: string | null;
  exportShape: BootstrapExportShape;
  runtimeFn: unknown;
}): string[] | null {
  const { code, exportShape, runtimeFn } = args;
  if (!code) return null;

  if (exportShape === "function") {
    const direct = extractParamsFromExportedFunctionCode(code);
    if (direct && direct.length) return direct;

    const refName = extractExportedFnName(code);
    if (refName) {
      const params = extractParamsFromNamedFunction(code, refName);
      if (params && params.length) return params;
    }

    const runtimeName = typeof runtimeFn === "function" && runtimeFn.name ? String(runtimeFn.name).trim() : "";
    if (runtimeName) {
      const params = extractParamsFromNamedFunction(code, runtimeName);
      if (params && params.length) return params;
    }

    return null;
  }

  const direct = extractParamsFromAttachExportCode(code);
  if (direct && direct.length) return direct;

  if (/\bexport\s*\{[\s\S]*?\battach\b[\s\S]*?\}/m.test(code)) {
    const params = extractParamsFromNamedFunction(code, "attach");
    if (params && params.length) return params;
  }

  const attachValueName = extractAttachValueNameFromObjectExport(code);
  if (attachValueName && attachValueName !== "attach") {
    const params = extractParamsFromNamedFunction(code, attachValueName);
    if (params && params.length) return params;
  }

  if (attachValueName === "attach") {
    const params = extractParamsFromNamedFunction(code, "attach");
    if (params && params.length) return params;
  }

  const runtimeName = typeof runtimeFn === "function" && runtimeFn.name ? String(runtimeFn.name).trim() : "";
  if (runtimeName && runtimeName !== "attach") {
    const params = extractParamsFromNamedFunction(code, runtimeName);
    if (params && params.length) return params;
  }

  return null;
}

export {
  extractParamsOverrideFromFile,
  isIdentifierToken,
  parseParamTokensFromFn,
  splitParams,
};
