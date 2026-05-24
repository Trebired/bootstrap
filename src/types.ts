type BootstrapLogMethod = (group: string, message: string, metadata?: unknown) => unknown;

type BootstrapLogEvent = {
  group: string;
  level: "error" | "fail" | "info" | "warn";
  message: string;
  metadata?: unknown;
};

type BootstrapGenericLogMethod = (...args: unknown[]) => unknown;

type BootstrapLogger = ((
  event: BootstrapLogEvent,
) => unknown) | {
  [key: string]: unknown;
  error?: BootstrapLogMethod | BootstrapGenericLogMethod;
  fail?: BootstrapLogMethod | BootstrapGenericLogMethod;
  fatal?: BootstrapGenericLogMethod;
  info?: BootstrapLogMethod | BootstrapGenericLogMethod;
  log?: BootstrapGenericLogMethod;
  warn?: BootstrapLogMethod | BootstrapGenericLogMethod;
  write?: BootstrapGenericLogMethod;
};

type NormalizedBootstrapLogger = {
  error: BootstrapLogMethod;
  fail: BootstrapLogMethod;
  info: BootstrapLogMethod;
  warn: BootstrapLogMethod;
};

type SuffixRules = {
  lastSuffix?: string;
  excludeSuffixes?: string[];
};

type BootstrapDirScanOptions = {
  include?: string[] | null;
  exclude?: string[] | null;
  allowNodeModules?: boolean;
};

type BootstrapFileScanOptions = {
  include?: string[] | null;
  exclude?: string[] | null;
  excludeSuffixes?: string[];
  lastSuffix?: string;
};

type BootstrapScanOptions = {
  dirs?: BootstrapDirScanOptions;
  files?: BootstrapFileScanOptions;
};

type BootstrapOptions = {
  dir: string;
  scan?: BootstrapScanOptions;
  verbose?: boolean;
  logger?: BootstrapLogger;
} & Record<string, unknown>;

type BootstrapSummary = {
  scanned: number;
  loaded: number;
  skipped: number;
  failed: number;
};

type BootstrapExportShape = "function" | "attach";

type BootstrapHandler = {
  exportShape: BootstrapExportShape;
  mod: unknown;
  runtimeFn: unknown;
};

type ParamBinding = {
  param: string;
  from: "dependencies" | "name";
  to: string;
};

type ResolvedBootstrapArguments = {
  ok: true;
  args: unknown[];
  meta: ParamBinding[];
  used: string[];
} | {
  ok: false;
  missing: string[];
  meta: ParamBinding[];
  used: string[];
};

export type {
  BootstrapDirScanOptions,
  BootstrapExportShape,
  BootstrapFileScanOptions,
  BootstrapGenericLogMethod,
  BootstrapLogEvent,
  BootstrapHandler,
  BootstrapLogger,
  BootstrapLogMethod,
  BootstrapOptions,
  BootstrapScanOptions,
  BootstrapSummary,
  NormalizedBootstrapLogger,
  ParamBinding,
  ResolvedBootstrapArguments,
  SuffixRules,
};
