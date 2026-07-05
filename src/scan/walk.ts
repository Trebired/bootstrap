import fs from "node:fs";
import path from "node:path";

import { BOOTSTRAP_LOG_GROUP } from "#go3m4pwdqt48";
import { isExcludedBySuffix, normalizeSuffixRules } from "#gxv0fwleavl3";
import type { NormalizedBootstrapLogger, SuffixRules } from "#63np0sf1s6f9";
import { formatError } from "#7vfj5fhk8sp9";
import { relFromRoot } from "#borism6zb02o";

function normalizeMatchValue(value: string): string {
  return String(value || "").trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
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

function walkBootstrapFiles(args: {
  allowNodeModules: boolean;
  rootAbs: string;
  dirsExclude: Set<string>;
  dirAbs: string;
  excludedSeen: Set<string>;
  filesExclude: Set<string>;
  filesInclude: Set<string>;
  suffixRules: SuffixRules;
  verbose: boolean;
  logger: NormalizedBootstrapLogger;
}): string[] {
  const { rootAbs, dirAbs, excludedSeen, verbose, logger } = args;
  const out: string[] = [];
  const normalizedSuffixRules = normalizeSuffixRules(args.suffixRules);
  const logExcluded = createExcludedLogger(dirAbs, excludedSeen, verbose, logger);
  const visitDir = (currentDir: string) => visitBootstrapDir({
    allowNodeModules: args.allowNodeModules,
    currentDir,
    dirAbs,
    dirsExclude: args.dirsExclude,
    filesExclude: args.filesExclude,
    filesInclude: args.filesInclude,
    logExcluded,
    logger,
    normalizedSuffixRules,
    out,
  }, visitDir);

  visitDir(rootAbs);
  return out;
}

function createExcludedLogger(
  dirAbs: string,
  excludedSeen: Set<string>,
  verbose: boolean,
  logger: NormalizedBootstrapLogger,
) {
  return (kind: string, absPath: string, reason: string) => {
    const rel = relFromRoot(absPath, dirAbs);
    const key = `${kind}::${rel}`;
    if (excludedSeen.has(key)) return;
    excludedSeen.add(key);
    if (verbose) logger.warn(BOOTSTRAP_LOG_GROUP, `skip (${kind}:${reason}) :: ${rel}`);
  };
}

function visitBootstrapDir(
  args: {
    allowNodeModules: boolean;
    currentDir: string;
    dirAbs: string;
    dirsExclude: Set<string>;
    filesExclude: Set<string>;
    filesInclude: Set<string>;
    logExcluded: (kind: string, absPath: string, reason: string) => void;
    logger: NormalizedBootstrapLogger;
    normalizedSuffixRules: ReturnType<typeof normalizeSuffixRules>;
    out: string[];
  },
  visitDir: (currentDir: string) => void,
): void {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(args.currentDir, { withFileTypes: true });
  } catch (error) {
    args.logger.error(BOOTSTRAP_LOG_GROUP, `scan-failed :: ${relFromRoot(args.currentDir, args.dirAbs)}: ${formatError(error)}`);
    return;
  }

  for (const entry of entries) {
    visitEntry({
      ...args,
      entry,
      visitDir,
    });
  }
}

function visitEntry(args: {
  allowNodeModules: boolean;
  currentDir: string;
  dirAbs: string;
  dirsExclude: Set<string>;
  entry: fs.Dirent;
  filesExclude: Set<string>;
  filesInclude: Set<string>;
  logExcluded: (kind: string, absPath: string, reason: string) => void;
  normalizedSuffixRules: ReturnType<typeof normalizeSuffixRules>;
  out: string[];
  visitDir: (currentDir: string) => void;
}): void {
  const name = args.entry && args.entry.name ? String(args.entry.name) : "";
  if (!name) return;

  const abs = path.join(args.currentDir, name);
  const relativePath = normalizeMatchValue(relFromRoot(abs, args.dirAbs));

  if (args.entry.isDirectory()) {
    if (shouldSkipDir(args, name, abs, relativePath)) return;
    args.visitDir(abs);
    return;
  }

  if (!args.entry.isFile() || shouldSkipFile(args, name, abs, relativePath)) return;
  args.out.push(abs);
}

function shouldSkipDir(
  args: Parameters<typeof visitEntry>[0],
  name: string,
  abs: string,
  relativePath: string,
): boolean {
  if (!args.allowNodeModules && name === "node_modules") {
    args.logExcluded("excluded-dir", abs, name);
    return true;
  }

  if (isExcludedBySuffix(name, args.normalizedSuffixRules) || matchesRule({ name, relativePath, rules: args.dirsExclude })) {
    args.logExcluded("excluded-dir", abs, name);
    return true;
  }

  return false;
}

function shouldSkipFile(
  args: Parameters<typeof visitEntry>[0],
  name: string,
  abs: string,
  relativePath: string,
): boolean {
  if (isExcludedBySuffix(name, args.normalizedSuffixRules) || matchesRule({ name, relativePath, rules: args.filesExclude })) {
    args.logExcluded("excluded-file", abs, name);
    return true;
  }

  if (!/\.(js|mjs|ts|mts)$/i.test(name)) return true;
  if (args.filesInclude.size && !matchesRule({ name, relativePath, rules: args.filesInclude })) return true;
  return false;
}

export { walkBootstrapFiles };
