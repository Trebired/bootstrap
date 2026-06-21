import { logPackageInitialized } from "@trebired/logger-adapter";

import { BOOTSTRAP_LOG_GROUP } from "#go3m4pwdqt48";
import { resolveLogger } from "#c5bjtgzvarhf";
import { loadModuleFile, nextImportRevision } from "#p4w1s2z41nxy";
import { invokeModuleHandler, resolveModuleHandler } from "#my58qsd8qazx";
import { extractParamsOverrideFromFile } from "#f931g6zwzlos";
import type { BootstrapOptions, BootstrapSummary } from "#63np0sf1s6f9";
import { envVerbose } from "#vl1kc579x5ul";
import { formatError } from "#7vfj5fhk8sp9";
import { isDir, readFileCached } from "#borism6zb02o";
import { discoverBootstrapFiles, resolveDependencies, resolveDirOption } from "./discovery.js";

async function bootstrap(options: BootstrapOptions): Promise<BootstrapSummary> {
  const cfg = normalizeBootstrapOptions(options);
  const logger = createBootstrapLogger(cfg);
  const verbose = typeof cfg.verbose === "boolean" ? cfg.verbose : envVerbose();
  const dependencies = resolveDependencies(cfg);
  const dir = resolveBootstrapDir(cfg, logger);
  const discovered = discoverBootstrapFiles({ dir, scan: cfg.scan, verbose, logger });
  const fileCodeCache = new Map<string, string | null>();
  const importRevision = nextImportRevision();
  const summary = createBootstrapSummary(discovered.summary.scanned);

  for (const file of discovered.ordered) {
    await bootstrapDiscoveredFile({
      file,
      fileCodeCache,
      importRevision,
      verbose,
      logger,
      dependencies,
      summary,
    });
  }

  logger.info(
    BOOTSTRAP_LOG_GROUP,
    `scan-summary scanned=${summary.scanned} loaded=${summary.loaded} skipped=${summary.skipped} failed=${summary.failed}`,
  );

  return summary;
}

function normalizeBootstrapOptions(options: BootstrapOptions): BootstrapOptions {
  return options && typeof options === "object" ? options : {} as BootstrapOptions;
}

function createBootstrapLogger(options: BootstrapOptions) {
  logPackageInitialized({
    adapter: options.loggerAdapter,
    fallback: "console",
    group: "bootstrap.initialize",
    logger: options.logger,
    source: "@trebired/bootstrap",
  });
  return resolveLogger(options.logger, options.loggerAdapter);
}

function resolveBootstrapDir(options: BootstrapOptions, logger: ReturnType<typeof resolveLogger>): string {
  const dir = resolveDirOption(options);
  if (!dir) {
    logger.fail(BOOTSTRAP_LOG_GROUP, "missing-dir");
    throw new Error("bootstrap-missing-dir");
  }

  if (!isDir(dir)) {
    logger.fail(BOOTSTRAP_LOG_GROUP, `dir-missing :: ${dir}`);
    throw new Error("bootstrap-dir-missing");
  }

  return dir;
}

function createBootstrapSummary(scanned: number): BootstrapSummary {
  return {
    scanned,
    loaded: 0,
    skipped: 0,
    failed: 0,
  };
}

async function bootstrapDiscoveredFile(args: {
  file: {
    abs: string;
    relativePath: string;
  };
  fileCodeCache: Map<string, string | null>;
  importRevision: number;
  verbose: boolean;
  logger: ReturnType<typeof resolveLogger>;
  dependencies: Record<string, unknown>;
  summary: BootstrapSummary;
}): Promise<void> {
  const imported = await importBootstrapFile(args);
  if (!imported) {
    return;
  }

  const code = readFileCached(args.fileCodeCache, args.file.abs);
  const handler = resolveModuleHandler(imported);
  if (!handler) {
    if (args.verbose) {
      args.logger.info(BOOTSTRAP_LOG_GROUP, `skip (no-handler) :: ${args.file.relativePath}`);
    }

    args.summary.skipped += 1;
    return;
  }

  const paramsOverride = extractParamsOverrideFromFile({
    code,
    exportShape: handler.exportShape,
    runtimeFn: handler.runtimeFn,
  });
  const ok = await invokeModuleHandler({
    handler,
    dependencies: args.dependencies,
    tag: args.file.relativePath,
    paramsOverride,
    paramsSource: paramsOverride?.length ? "file" : "runtime",
    verbose: args.verbose,
    logger: args.logger,
  });

  if (ok) args.summary.loaded += 1;
  else args.summary.failed += 1;
}

async function importBootstrapFile(args: {
  file: {
    abs: string;
    relativePath: string;
  };
  importRevision: number;
  verbose: boolean;
  logger: ReturnType<typeof resolveLogger>;
  summary: BootstrapSummary;
}): Promise<unknown | null> {
  if (args.verbose) {
    args.logger.info(BOOTSTRAP_LOG_GROUP, `load :: ${args.file.relativePath}`);
  }

  try {
    return await loadModuleFile(args.file.abs, args.importRevision);
  } catch (error) {
    args.logger.error(BOOTSTRAP_LOG_GROUP, `load-failed :: ${args.file.relativePath}: ${formatError(error)}`);
    args.summary.failed += 1;
    return null;
  }
}

export { bootstrap };
export default bootstrap;
