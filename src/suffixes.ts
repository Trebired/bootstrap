import path from "node:path";

import { DEFAULT_LAST_SUFFIX } from "./constants.js";
import type { SuffixRules } from "./types.js";

function normalizeSuffixRules(rules?: SuffixRules): Required<SuffixRules> {
  const rawExcludeSuffixes = Array.isArray(rules?.excludeSuffixes) ? rules.excludeSuffixes : [];

  return {
    lastSuffix: String(rules?.lastSuffix || DEFAULT_LAST_SUFFIX).trim().toLowerCase() || DEFAULT_LAST_SUFFIX,
    excludeSuffixes: rawExcludeSuffixes.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean),
  };
}

function isAttachExtension(ext: string): boolean {
  return ext === ".js"
    || ext === ".mjs"
    || ext === ".ts"
    || ext === ".mts";
}

function suffixOfName(fileName: string, rules?: SuffixRules): string {
  const normalizedRules = normalizeSuffixRules(rules);
  const ext = path.extname(fileName);
  const normalizedExt = String(ext || "").trim().toLowerCase();

  if (normalizedExt.startsWith(".")) {
    const extSuffix = normalizedExt.slice(1);
    if (normalizedRules.excludeSuffixes.includes(extSuffix)) return extSuffix;
  }

  const base = ext ? fileName.slice(0, -ext.length) : fileName;
  const lastDot = base.lastIndexOf(".");
  if (lastDot === -1) return "";
  return base.slice(lastDot + 1).trim().toLowerCase();
}

function isExcludedBySuffix(fileName: string, rules?: SuffixRules): boolean {
  const normalizedRules = normalizeSuffixRules(rules);
  const suffix = suffixOfName(String(fileName || ""), normalizedRules);
  return normalizedRules.excludeSuffixes.includes(suffix);
}

function isAttachFile(fileName: string, rules?: SuffixRules): boolean {
  const normalizedRules = normalizeSuffixRules(rules);
  if (isExcludedBySuffix(fileName, normalizedRules)) return false;

  const ext = path.extname(fileName);
  if (!isAttachExtension(ext)) return false;

  const suffix = suffixOfName(fileName, normalizedRules);
  if (!suffix) return false;
  if (suffix === normalizedRules.lastSuffix) return true;
  return /^\d+$/.test(suffix);
}

function numericOrder(fileName: string, rules?: SuffixRules): number {
  const normalizedRules = normalizeSuffixRules(rules);
  const suffix = suffixOfName(fileName, normalizedRules);
  if (!suffix) return Number.MAX_SAFE_INTEGER;
  if (suffix === normalizedRules.lastSuffix) return Number.MAX_SAFE_INTEGER;
  if (/^\d+$/.test(suffix)) return parseInt(suffix, 10);
  return Number.MAX_SAFE_INTEGER;
}

function compareFiles(a: string, b: string, rules?: SuffixRules): number {
  const na = numericOrder(a, rules);
  const nb = numericOrder(b, rules);
  if (na !== nb) return na - nb;
  return a.localeCompare(b);
}

export {
  DEFAULT_LAST_SUFFIX,
  normalizeSuffixRules,
  suffixOfName,
  isExcludedBySuffix,
  isAttachFile,
  numericOrder,
  compareFiles,
};
