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
  const cfg = options && typeof options === "object" ? options : {} as BootstrapOptions;
  const logger = resolveLogger(cfg.logger, cfg.loggerAdapter);
  logPackageInitialized({
    adapter: cfg.loggerAdapter,
    fallback: "console",
    group: "bootstrap.initialize",
    logger: cfg.logger,
    source: "@trebired/bootstrap",
  });
  const verbose = typeof cfg.verbose === "boolean" ? cfg.verbose : envVerbose();
  const dependencies = resolveDependencies(cfg);
  const dir = resolveDirOption(cfg);

  if (!dir) {
    logger.fail(BOOTSTRAP_LOG_GROUP, "missing-dir");
    throw new Error("bootstrap-missing-dir");
  }

  if (!isDir(dir)) {
    logger.fail(BOOTSTRAP_LOG_GROUP, `dir-missing :: ${dir}`);
    throw new Error("bootstrap-dir-missing");
  }

  const discovered = discoverBootstrapFiles({
    dir,
    scan: cfg.scan,
    verbose,
    logger,
  });
  const fileCodeCache = new Map<string, string | null>();
  const importRevision = nextImportRevision();
  const summary: BootstrapSummary = {
    scanned: discovered.summary.scanned,
    loaded: 0,
    skipped: 0,
    failed: 0,
  };

  for (const file of discovered.ordered) {
    if (verbose) logger.info(BOOTSTRAP_LOG_GROUP, `load :: ${file.relativePath}`);

    let imported: unknown;
    try {
      imported = await loadModuleFile(file.abs, importRevision);
    } catch (error) {
      logger.error(BOOTSTRAP_LOG_GROUP, `load-failed :: ${file.relativePath}: ${formatError(error)}`);
      summary.failed += 1;
      continue;
    }

    const code = readFileCached(fileCodeCache, file.abs);
    const handler = resolveModuleHandler(imported);
    if (!handler) {
      if (verbose) logger.info(BOOTSTRAP_LOG_GROUP, `skip (no-handler) :: ${file.relativePath}`);
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
      tag: file.relativePath,
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
