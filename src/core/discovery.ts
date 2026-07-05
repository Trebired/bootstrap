import fs from "node:fs";
import path from "node:path";

import { DEFAULT_LAST_SUFFIX } from "#go3m4pwdqt48";
import { compareFiles, isAttachFile, isExcludedBySuffix, normalizeSuffixRules } from "#gxv0fwleavl3";
import type { BootstrapOptions, BootstrapScanOptions, NormalizedBootstrapLogger, SuffixRules } from "#63np0sf1s6f9";
import { formatError } from "#7vfj5fhk8sp9";
import { isDir, relFromRoot } from "#borism6zb02o";
import { cleanStringList, isRecord, toString } from "#7iidjfwwxm9c";
import { walkBootstrapFiles } from "#ojhxpm0lszqj";

const RESERVED_OPTION_KEYS = new Set([
  "dir",
  "lifecycle",
  "logger",
  "loggerAdapter",
  "scan",
  "subsystems",
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

type DiscoveredBootstrapFile = {
  abs: string;
  name: string;
  relativePath: string;
};

type DiscoverBootstrapFilesResult = {
  dir: string;
  ordered: DiscoveredBootstrapFile[];
  suffixRules: Required<SuffixRules>;
  summary: {
    scanned: number;
  };
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
    lastSuffix: toString(files.lastSuffix).toLowerCase() || DEFAULT_LAST_SUFFIX,
  };
}

function resolveDirOption(options: Pick<BootstrapOptions, "dir">): string {
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
  logger: NormalizedBootstrapLogger;
}): string[] {
  const { dir, scan, suffixRules, verbose, logger } = args;
  const roots: string[] = [];

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch (error) {
    logger.fail("bootstrap", `dir-scan-failed :: ${dir}: ${formatError(error)}`);
    throw error;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (!isDir(full)) continue;

    const relativePath = normalizeMatchValue(relFromRoot(full, dir));

    if (!scan.allowNodeModules && entry === "node_modules") {
      if (verbose) logger.warn("bootstrap", `skip (excluded-root:${entry}) :: ${relFromRoot(full, dir)}`);
      continue;
    }

    if (isExcludedBySuffix(entry, suffixRules)) {
      if (verbose) logger.warn("bootstrap", `skip (excluded-root:${entry}) :: ${relFromRoot(full, dir)}`);
      continue;
    }

    if (matchesRule({ name: entry, relativePath, rules: scan.dirsExclude })) {
      if (verbose) logger.warn("bootstrap", `skip (excluded-root:${entry}) :: ${relFromRoot(full, dir)}`);
      continue;
    }

    if (scan.dirsInclude.size && !matchesRule({ name: entry, relativePath, rules: scan.dirsInclude })) continue;

    roots.push(full);
  }

  return roots;
}

function discoverBootstrapFiles(args: {
  dir: string;
  scan: unknown;
  verbose: boolean;
  logger: NormalizedBootstrapLogger;
}): DiscoverBootstrapFilesResult {
  const { dir, logger, scan: scanInput, verbose } = args;
  const scan = normalizeScanConfig(scanInput);
  const suffixRules = normalizeSuffixRules({
    excludeSuffixes: scan.excludeSuffixes,
    lastSuffix: scan.lastSuffix,
  });
  const excludedSeen = new Set<string>();
  const roots = resolveRoots({ dir, scan, suffixRules, verbose, logger });
  const collected = collectBootstrapFiles(dir, roots, scan, suffixRules, excludedSeen, verbose, logger);
  collected.ordered.sort((a, b) => compareFiles(a.name, b.name, suffixRules) || a.abs.localeCompare(b.abs));

  return {
    dir,
    ordered: collected.ordered,
    suffixRules,
    summary: {
      scanned: collected.scanned,
    },
  };
}

function collectBootstrapFiles(
  dir: string,
  roots: string[],
  scan: NormalizedScanConfig,
  suffixRules: Required<SuffixRules>,
  excludedSeen: Set<string>,
  verbose: boolean,
  logger: NormalizedBootstrapLogger,
): {
  ordered: DiscoveredBootstrapFile[];
  scanned: number;
} {
  const ordered: DiscoveredBootstrapFile[] = [];
  let scanned = 0;

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
    scanned += all.length;
    ordered.push(...selectAttachFiles(dir, all, scan.filesInclude, suffixRules));
  }

  return {
    ordered,
    scanned,
  };
}

function selectAttachFiles(
  dir: string,
  filePaths: string[],
  filesInclude: Set<string>,
  suffixRules: Required<SuffixRules>,
): DiscoveredBootstrapFile[] {
  const ordered: DiscoveredBootstrapFile[] = [];

  for (const fileAbs of filePaths) {
    const name = path.basename(fileAbs);
    const relativePath = normalizeMatchValue(relFromRoot(fileAbs, dir));
    if (filesInclude.size && !matchesRule({ name, relativePath, rules: filesInclude })) continue;
    if (!isAttachFile(name, suffixRules)) continue;
    ordered.push({
      abs: fileAbs,
      name,
      relativePath: relFromRoot(fileAbs, dir),
    });
  }

  return ordered;
}

export {
  discoverBootstrapFiles,
  normalizeScanConfig,
  resolveDependencies,
  resolveDirOption,
};
export type {
  DiscoveredBootstrapFile,
  DiscoverBootstrapFilesResult,
  NormalizedScanConfig,
};
