import { isIdentifierToken, parseParamTokensFromFn } from "./extract.js";
import type { ParamBinding, ResolvedBootstrapArguments } from "#63np0sf1s6f9";

function buildDependencyIndex(dependencies: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();

  for (const key of Object.keys(dependencies || {})) {
    const normalized = String(key || "").trim();
    if (normalized) map.set(normalized.toLowerCase(), normalized);
  }

  return map;
}

function resolveArgsForFunction(
  dependencies: Record<string, unknown>,
  fn: unknown,
  paramsOverride: string[] | null,
): ResolvedBootstrapArguments {
  const dependencyIndex = buildDependencyIndex(dependencies);
  const tokens = Array.isArray(paramsOverride) && paramsOverride.length
    ? paramsOverride
    : parseParamTokensFromFn(fn);

  if (!tokens.length) {
    if (typeof fn === "function" && fn.length === 0) return { ok: true, args: [], meta: [], used: [] };
    return { ok: false, missing: ["<params-unparseable>"], meta: [], used: [] };
  }

  if (tokens.length === 1 && !isIdentifierToken(tokens[0])) {
    return {
      ok: true,
      args: [dependencies],
      meta: [{ param: tokens[0], from: "dependencies", to: "dependencies" }],
      used: tokens,
    };
  }

  const args: unknown[] = [];
  const meta: ParamBinding[] = [];
  const missing: string[] = [];

  for (const token of tokens) {
    const param = String(token || "").trim();

    if (!isIdentifierToken(param)) {
      missing.push(`<unsupported-param:${param}>`);
      continue;
    }

    const low = param.toLowerCase();
    if (low === "dependencies" || low === "deps") {
      args.push(dependencies);
      meta.push({ param, from: "dependencies", to: "dependencies" });
      continue;
    }

    const realKey = dependencyIndex.get(low);
    if (!realKey) {
      missing.push(param);
      continue;
    }

    args.push(dependencies[realKey]);
    meta.push({ param, from: "name", to: realKey });
  }

  if (missing.length) return { ok: false, missing, meta, used: tokens };
  return { ok: true, args, meta, used: tokens };
}

function formatMeta(meta: ParamBinding[]): string {
  const parts: string[] = [];
  for (const item of Array.isArray(meta) ? meta : []) {
    if (!item || !item.param) continue;
    if (item.from === "name") parts.push(`${item.param}<-${item.to}`);
    else if (item.from === "dependencies") parts.push(`${item.param}<-dependencies`);
  }

  return parts.join(",");
}

export { buildDependencyIndex, formatMeta, resolveArgsForFunction };
