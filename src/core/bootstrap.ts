import fs from "node:fs";
import path from "node:path";

import { BOOTSTRAP_LOG_GROUP } from "../constants.js";
import { resolveLogger } from "../logging.js";
import { loadModuleFile, nextImportRevision } from "../module/import.js";
import { invokeModuleHandler, resolveModuleHandler } from "../module/handler.js";
import { extractParamsOverrideFromFile } from "../params/extract.js";
import { walkBootstrapFiles } from "../scan/walk.js";
import { compareFiles, isAttachFile, isExcludedBySuffix, normalizeSuffixRules } from "../suffixes.js";
import type { BootstrapOptions, BootstrapScanOptions, BootstrapSummary, SuffixRules } from "../types.js";
import { cleanStringList, isRecord, toString } from "../utils/values.js";
import { envVerbose } from "../utils/env.js";
import { formatError } from "../utils/errors.js";
import { isDir, readFileCached, relFromRoot } from "../utils/files.js";

const RESERVED_OPTION_KEYS = new Set([
  "dir",
  "logger",
  "scan",
  "verbose",
]);

type NormalizedScanConfig = {
  allowNodeModules: boolean;
  dirsInclude: Set<string>;
  dirsExclude: Set<string>;
  filesInclude: Set<string>;
  filesExclude: Set<string>;
  excludeSuffixes: string[];
  lastSuffix: string;
};

function normalizeMatchValue(value: string): string {
  return String(value || "").trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function normalizeMatchSet(values: Iterable<unknown> | null | undefined): Set<string> {
  return new Set(cleanStringList(values).map(normalizeMatchValue).filter(Boolean));
}

function matchesRule(args: {
  name: string;
  relativePath: string;
  rules: Set<string>;
}): boolean {
  const { name, relativePath, rules } = args;
  if (!rules.size) return false;

  const normalizedName = normalizeMatchValue(name);
  const normalizedRelativePath = normalizeMatchValue(relativePath);
  return rules.has(normalizedName) || rules.has(normalizedRelativePath);
}

function normalizeExcludeSuffixes(values: Iterable<unknown> | null | undefined): string[] {
  return cleanStringList(values).map((value) => value.toLowerCase());
}

function normalizeScanConfig(scan: unknown): NormalizedScanConfig {
  const cfg = isRecord(scan) ? scan as BootstrapScanOptions : {};
  const dirs = isRecord(cfg.dirs) ? cfg.dirs : {};
  const files = isRecord(cfg.files) ? cfg.files : {};

  return {
    allowNodeModules: Boolean(dirs.allowNodeModules),
    dirsInclude: normalizeMatchSet(dirs.include),
    dirsExclude: normalizeMatchSet(dirs.exclude),
    filesInclude: normalizeMatchSet(files.include),
    filesExclude: normalizeMatchSet(files.exclude),
    excludeSuffixes: normalizeExcludeSuffixes(files.excludeSuffixes),
    lastSuffix: toString(files.lastSuffix).toLowerCase() || "a",
  };
}

function resolveDirOption(options: BootstrapOptions): string {
  const dir = toString(options.dir);
  if (!dir) return "";
  return path.resolve(dir);
}

function resolveDependencies(options: BootstrapOptions): Record<string, unknown> {
  const dependencies: Record<string, unknown> = {};

  for (const key of Object.keys(options || {})) {
    if (RESERVED_OPTION_KEYS.has(key)) continue;
    dependencies[key] = options[key];
  }

  return dependencies;
}

function resolveRoots(args: {
  dir: string;
  scan: NormalizedScanConfig;
  suffixRules: Required<SuffixRules>;
  verbose: boolean;
  logger: ReturnType<typeof resolveLogger>;
}): string[] {
  const { dir, scan, suffixRules, verbose, logger } = args;
  const roots: string[] = [];

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch (error) {
    logger.fail(BOOTSTRAP_LOG_GROUP, `dir-scan-failed :: ${dir}: ${formatError(error)}`);
    throw error;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (!isDir(full)) continue;

    const relativePath = normalizeMatchValue(relFromRoot(full, dir));

    if (!scan.allowNodeModules && entry === "node_modules") {
      if (verbose) logger.warn(BOOTSTRAP_LOG_GROUP, `skip (excluded-root:${entry}) :: ${relFromRoot(full, dir)}`);
      continue;
    }

    if (isExcludedBySuffix(entry, suffixRules)) {
      if (verbose) logger.warn(BOOTSTRAP_LOG_GROUP, `skip (excluded-root:${entry}) :: ${relFromRoot(full, dir)}`);
      continue;
    }

    if (matchesRule({ name: entry, relativePath, rules: scan.dirsExclude })) {
      if (verbose) logger.warn(BOOTSTRAP_LOG_GROUP, `skip (excluded-root:${entry}) :: ${relFromRoot(full, dir)}`);
      continue;
    }

    if (scan.dirsInclude.size && !matchesRule({ name: entry, relativePath, rules: scan.dirsInclude })) continue;

    roots.push(full);
  }

  return roots;
}

async function bootstrap(options: BootstrapOptions): Promise<BootstrapSummary> {
  const cfg = options && typeof options === "object" ? options : {} as BootstrapOptions;
  const logger = resolveLogger(cfg.logger);
  const verbose = typeof cfg.verbose === "boolean" ? cfg.verbose : envVerbose();
  const dependencies = resolveDependencies(cfg);
  const scan = normalizeScanConfig(cfg.scan);

  const dir = resolveDirOption(cfg);
  if (!dir) {
    logger.fail(BOOTSTRAP_LOG_GROUP, "missing-dir");
    throw new Error("bootstrap-missing-dir");
  }

  if (!isDir(dir)) {
    logger.fail(BOOTSTRAP_LOG_GROUP, `dir-missing :: ${dir}`);
    throw new Error("bootstrap-dir-missing");
  }

  const suffixRules = normalizeSuffixRules({
    excludeSuffixes: scan.excludeSuffixes,
    lastSuffix: scan.lastSuffix,
  });
  const excludedSeen = new Set<string>();
  const fileCodeCache = new Map<string, string | null>();
  const importRevision = nextImportRevision();
  const roots = resolveRoots({ dir, scan, suffixRules, verbose, logger });
  const attachablesRaw: Array<{ abs: string; name: string }> = [];
  const summary: BootstrapSummary = {
    scanned: 0,
    loaded: 0,
    skipped: 0,
    failed: 0,
  };

  for (const root of roots) {
    const all = walkBootstrapFiles({
      allowNodeModules: scan.allowNodeModules,
      rootAbs: root,
      dirsExclude: scan.dirsExclude,
      dirAbs: dir,
      excludedSeen,
      filesExclude: scan.filesExclude,
      filesInclude: scan.filesInclude,
      suffixRules,
      verbose,
      logger,
    });
    summary.scanned += all.length;

    for (const fileAbs of all) {
      const name = path.basename(fileAbs);
      const relativePath = normalizeMatchValue(relFromRoot(fileAbs, dir));

      if (scan.filesInclude.size && !matchesRule({ name, relativePath, rules: scan.filesInclude })) continue;
      if (isAttachFile(name, suffixRules)) attachablesRaw.push({ abs: fileAbs, name });
    }
  }

  const ordered = attachablesRaw
    .slice()
    .sort((a, b) => compareFiles(a.name, b.name, suffixRules) || a.abs.localeCompare(b.abs));

  for (const file of ordered) {
    const rel = relFromRoot(file.abs, dir);
    if (verbose) logger.info(BOOTSTRAP_LOG_GROUP, `load :: ${rel}`);

    let imported: unknown;
    try {
      imported = await loadModuleFile(file.abs, importRevision);
    } catch (error) {
      logger.error(BOOTSTRAP_LOG_GROUP, `load-failed :: ${rel}: ${formatError(error)}`);
      summary.failed += 1;
      continue;
    }

    const code = readFileCached(fileCodeCache, file.abs);
    const handler = resolveModuleHandler(imported);
    if (!handler) {
      if (verbose) logger.info(BOOTSTRAP_LOG_GROUP, `skip (no-handler) :: ${rel}`);
      summary.skipped += 1;
      continue;
    }

    const paramsOverride = extractParamsOverrideFromFile({
      code,
      exportShape: handler.exportShape,
      runtimeFn: handler.runtimeFn,
    });
    const paramsSource = paramsOverride && paramsOverride.length ? "file" : "runtime";

    const ok = await invokeModuleHandler({
      handler,
      dependencies,
      tag: rel,
      paramsOverride,
      paramsSource,
      verbose,
      logger,
    });

    if (ok) summary.loaded += 1;
    else summary.failed += 1;
  }

  logger.info(
    BOOTSTRAP_LOG_GROUP,
    `scan-summary scanned=${summary.scanned} loaded=${summary.loaded} skipped=${summary.skipped} failed=${summary.failed}`,
  );

  return summary;
}

export { bootstrap };
export default bootstrap;
