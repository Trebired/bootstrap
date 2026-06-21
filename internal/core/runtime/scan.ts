import { BOOTSTRAP_LOG_GROUP } from "#go3m4pwdqt48";
import { loadModuleFile, nextImportRevision } from "#p4w1s2z41nxy";
import { invokeModuleHandler, resolveModuleHandler } from "#my58qsd8qazx";
import { extractParamsOverrideFromFile } from "#f931g6zwzlos";
import { formatError } from "#7vfj5fhk8sp9";
import { isDir, readFileCached } from "#borism6zb02o";
import { discoverBootstrapFiles, resolveDirOption } from "#2g6zs1tw5mep";
import type { BootstrapRuntimeImpl } from "#6pk4xe2v9lab";
import { resolveLifecycleSubsystemExport } from "./shared.js";

async function loadScannedSubsystems(runtime: BootstrapRuntimeImpl): Promise<void> {
  const dir = resolveDirOption(runtime.options);
  if (!dir) {
    return;
  }

  ensureRuntimeDir(runtime, dir);
  const discovered = discoverBootstrapFiles({
    dir,
    scan: runtime.options.scan,
    verbose: runtime.verbose,
    logger: runtime.logger,
  });
  const fileCodeCache = new Map<string, string | null>();
  const importRevision = nextImportRevision();

  runtime.lastSummary.scanned += discovered.summary.scanned;
  for (const [index, file] of discovered.ordered.entries()) {
    await loadScannedFile(runtime, fileCodeCache, importRevision, file, index);
  }

  runtime.scanGeneration += discovered.ordered.length + 1;
}

function ensureRuntimeDir(runtime: BootstrapRuntimeImpl, dir: string): void {
  if (isDir(dir)) {
    return;
  }

  runtime.logger.fail(BOOTSTRAP_LOG_GROUP, `dir-missing :: ${dir}`);
  throw new Error("bootstrap-dir-missing");
}

async function loadScannedFile(
  runtime: BootstrapRuntimeImpl,
  fileCodeCache: Map<string, string | null>,
  importRevision: number,
  file: {
    abs: string;
    relativePath: string;
  },
  index: number,
): Promise<void> {
  if (runtime.verbose) {
    runtime.logger.info(BOOTSTRAP_LOG_GROUP, `load :: ${file.relativePath}`);
  }

  const imported = await importScannedFile(runtime, file, importRevision);
  if (!imported) {
    return;
  }

  const lifecycleSubsystem = resolveLifecycleSubsystemExport(imported, file.relativePath, runtime.scanGeneration + index);
  if (lifecycleSubsystem) {
    runtime.dynamicSubsystems.push(lifecycleSubsystem);
    return;
  }

  await loadLegacyScannedModule(runtime, fileCodeCache, imported, file, index);
}

async function importScannedFile(
  runtime: BootstrapRuntimeImpl,
  file: {
    abs: string;
    relativePath: string;
  },
  importRevision: number,
): Promise<unknown | null> {
  try {
    return await loadModuleFile(file.abs, importRevision);
  } catch (error) {
    runtime.logger.error(BOOTSTRAP_LOG_GROUP, `load-failed :: ${file.relativePath}: ${formatError(error)}`);
    runtime.lastSummary.failed += 1;
    return null;
  }
}

async function loadLegacyScannedModule(
  runtime: BootstrapRuntimeImpl,
  fileCodeCache: Map<string, string | null>,
  imported: unknown,
  file: {
    abs: string;
    relativePath: string;
  },
  index: number,
): Promise<void> {
  const code = readFileCached(fileCodeCache, file.abs);
  const handler = resolveModuleHandler(imported);
  if (!handler) {
    if (runtime.verbose) {
      runtime.logger.info(BOOTSTRAP_LOG_GROUP, `skip (no-handler) :: ${file.relativePath}`);
    }

    runtime.lastSummary.skipped += 1;
    return;
  }

  const paramsOverride = extractParamsOverrideFromFile({
    code,
    exportShape: handler.exportShape,
    runtimeFn: handler.runtimeFn,
  });
  runtime.dynamicSubsystems.push(createLegacyScannedSubsystem(runtime, file.relativePath, handler, paramsOverride, index));
}

function createLegacyScannedSubsystem(
  runtime: BootstrapRuntimeImpl,
  relativePath: string,
  handler: NonNullable<ReturnType<typeof resolveModuleHandler>>,
  paramsOverride: string[] | null,
  index: number,
) {
  const paramsSource = paramsOverride && paramsOverride.length ? "file" : "runtime";

  return {
    id: relativePath,
    name: relativePath,
    order: runtime.scanGeneration + index,
    dependsOn: [],
    source: "scanned-legacy" as const,
    bootstrapHook: async () => {
      const ok = await invokeModuleHandler({
        handler,
        dependencies: runtime.dependencies,
        tag: relativePath,
        paramsOverride,
        paramsSource,
        verbose: runtime.verbose,
        logger: runtime.logger,
      });

      if (!ok) {
        throw new Error(`bootstrap-legacy-module-failed:${relativePath}`);
      }
    },
    shutdownHook: null,
    degradeHook: null,
  };
}

export {
  loadScannedSubsystems,
};
