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

  const resolved = tokens.map((token) => resolveParamBinding(token, dependencies, dependencyIndex));
  const args = resolved.filter(isResolvedBindingOk).map((item) => item.value);
  const meta = resolved.filter(isResolvedBindingOk).map((item) => item.meta);
  const missing = resolved.filter(isResolvedBindingMissing).map((item) => item.missing);

  if (missing.length) return { ok: false, missing, meta, used: tokens };
  return { ok: true, args, meta, used: tokens };
}

function resolveParamBinding(
  token: string,
  dependencies: Record<string, unknown>,
  dependencyIndex: Map<string, string>,
):
  | { ok: true; meta: ParamBinding; value: unknown }
  | { missing: string; ok: false } {
  const param = String(token || "").trim();
  if (!isIdentifierToken(param)) {
    return { ok: false, missing: `<unsupported-param:${param}>` };
  }

  const low = param.toLowerCase();
  if (low === "dependencies" || low === "deps") {
    return {
      ok: true,
      value: dependencies,
      meta: { param, from: "dependencies", to: "dependencies" },
    };
  }

  const realKey = dependencyIndex.get(low);
  if (!realKey) {
    return { ok: false, missing: param };
  }

  return {
    ok: true,
    value: dependencies[realKey],
    meta: { param, from: "name", to: realKey },
  };
}

function isResolvedBindingOk(
  item: ReturnType<typeof resolveParamBinding>,
): item is Extract<ReturnType<typeof resolveParamBinding>, {
  ok: true;
}> {
  return item.ok;
}

function isResolvedBindingMissing(
  item: ReturnType<typeof resolveParamBinding>,
): item is Extract<ReturnType<typeof resolveParamBinding>, {
  ok: false;
}> {
  return !item.ok;
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
