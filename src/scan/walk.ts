import fs from "node:fs";
import path from "node:path";

import { BOOTSTRAP_LOG_GROUP } from "../constants.js";
import { isExcludedBySuffix, normalizeSuffixRules } from "../suffixes.js";
import type { NormalizedBootstrapLogger, SuffixRules } from "../types.js";
import { formatError } from "../utils/errors.js";
import { relFromRoot } from "../utils/files.js";

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
  const { allowNodeModules, rootAbs, dirsExclude, dirAbs, excludedSeen, filesExclude, filesInclude, suffixRules, verbose, logger } = args;
  const out: string[] = [];
  const normalizedSuffixRules = normalizeSuffixRules(suffixRules);

  function logExcluded(kind: string, absPath: string, reason: string) {
    const rel = relFromRoot(absPath, dirAbs);
    const key = `${kind}::${rel}`;
    if (excludedSeen.has(key)) return;
    excludedSeen.add(key);
    if (verbose) logger.warn(BOOTSTRAP_LOG_GROUP, `skip (${kind}:${reason}) :: ${rel}`);
  }

  function visitDir(currentDir: string) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (error) {
      logger.error(BOOTSTRAP_LOG_GROUP, `scan-failed :: ${relFromRoot(currentDir, dirAbs)}: ${formatError(error)}`);
      return;
    }

    for (const entry of entries) {
      const name = entry && entry.name ? String(entry.name) : "";
      if (!name) continue;

      const abs = path.join(currentDir, name);
      const relativePath = normalizeMatchValue(relFromRoot(abs, dirAbs));

      if (entry.isDirectory()) {
        if (!allowNodeModules && name === "node_modules") {
          logExcluded("excluded-dir", abs, name);
          continue;
        }

        if (isExcludedBySuffix(name, normalizedSuffixRules)) {
          logExcluded("excluded-dir", abs, name);
          continue;
        }

        if (matchesRule({ name, relativePath, rules: dirsExclude })) {
          logExcluded("excluded-dir", abs, name);
          continue;
        }

        visitDir(abs);
        continue;
      }

      if (!entry.isFile()) continue;

      if (isExcludedBySuffix(name, normalizedSuffixRules)) {
        logExcluded("excluded-file", abs, name);
        continue;
      }

      if (matchesRule({ name, relativePath, rules: filesExclude })) {
        logExcluded("excluded-file", abs, name);
        continue;
      }

      if (!/\.(js|mjs|ts|mts)$/i.test(name)) continue;
      if (filesInclude.size && !matchesRule({ name, relativePath, rules: filesInclude })) continue;
      out.push(abs);
    }
  }

  visitDir(rootAbs);
  return out;
}

export { walkBootstrapFiles };
