import type {
  BootstrapConfig,
  BootstrapConfigurableOptions,
  NormalizedBootstrapConfig,
} from "./types.js";
import { PACKAGE_VERSION } from "#1nadc3z2pnei";
import {
  isRecord,
  toTrimmedString,
  uniqueStrings,
} from "@trebired/utils";
import { resolveForVersion } from "@trebired/utils";

type NormalizeOptions = {
  configPath?: string;
  requireForVersion?: boolean;
};

function defineConfig<TConfig extends BootstrapConfig>(config: TConfig): TConfig {
  return config;
}

function normalizeConfig(
  config: BootstrapConfig = {},
  options: NormalizeOptions = {},
): NormalizedBootstrapConfig {
  if (!isRecord(config)) {
    throw new Error("bootstrap config must be an object");
  }

  return pickDefined({
      dir: normalizeString(config.dir),
      forVersion: normalizeForVersion(config, options),
      lifecycle: normalizeLifecycle(config.lifecycle),
      scan: normalizeScan(config.scan),
      verbose: typeof config.verbose === "boolean" ? config.verbose : undefined,
  }) as NormalizedBootstrapConfig;
}

function mergeConfigOptions<TOptions extends BootstrapConfigurableOptions>(
  config: NormalizedBootstrapConfig,
  options: TOptions,
): TOptions {
  const { forVersion: _forVersion, ...configOptions } = config;
  return {
    ...configOptions,
    ...options,
    lifecycle: mergeObjects(config.lifecycle, options.lifecycle),
    scan: mergeScan(config.scan, options.scan),
  } as TOptions;
}

function normalizeLifecycle(input: BootstrapConfig["lifecycle"]): BootstrapConfig["lifecycle"] {
  if (!isRecord(input)) return undefined;
  return pickDefined({
      allowRestart: typeof input.allowRestart === "boolean" ? input.allowRestart : undefined,
      shutdownTimeoutMs: normalizeNumber(input.shutdownTimeoutMs),
  });
}

function normalizeScan(input: BootstrapConfig["scan"]): BootstrapConfig["scan"] {
  if (!isRecord(input)) return undefined;
  return pickDefined({
      dirs: normalizeScanDirs(input.dirs),
      files: normalizeScanFiles(input.files),
  });
}

function normalizeScanDirs(input: BootstrapConfig["scan"] extends { dirs?: infer T } ? T : never) {
  if (!isRecord(input)) return undefined;
  return pickDefined({
      allowNodeModules: typeof input.allowNodeModules === "boolean" ? input.allowNodeModules : undefined,
      exclude: normalizeStringList(input.exclude),
      include: normalizeStringList(input.include),
  });
}

function normalizeScanFiles(input: BootstrapConfig["scan"] extends { files?: infer T } ? T : never) {
  if (!isRecord(input)) return undefined;
  return pickDefined({
      exclude: normalizeStringList(input.exclude),
      excludeSuffixes: normalizeStringList(input.excludeSuffixes),
      include: normalizeStringList(input.include),
      lastSuffix: normalizeString(input.lastSuffix),
  });
}

function mergeScan(left: BootstrapConfig["scan"], right: BootstrapConfig["scan"]): BootstrapConfig["scan"] {
  const merged = mergeObjects(left, right);
  return merged
  ? {
    ...merged,
    dirs: mergeObjects(left?.dirs, right?.dirs),
    files: mergeObjects(left?.files, right?.files),
  }
  : undefined;
}

function mergeObjects<TValue extends object>(left: TValue | undefined, right: TValue | undefined): TValue | undefined {
  if (!left && !right) return undefined;
  return {
    ...(left || {}),
    ...(right || {}),
  } as TValue;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeForVersion(
  config: BootstrapConfig,
  options: NormalizeOptions,
): string {
  return resolveForVersion({
      configPath: options.configPath,
      forVersion: config.forVersion,
      label: "bootstrap",
      packageVersion: PACKAGE_VERSION,
      requireForVersion: options.requireForVersion,
  });
}

function normalizeString(value: unknown): string | undefined {
  const normalized = toTrimmedString(value);
  return normalized || undefined;
}

function normalizeStringList(value: unknown): string[] | undefined {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const normalized = uniqueStrings(values);
  return normalized.length > 0 ? normalized : undefined;
}

function pickDefined<TValue extends Record<string, unknown>>(input: TValue): Partial<TValue> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<TValue>;
}

export {
  defineConfig,
  mergeConfigOptions,
  normalizeConfig,
};
