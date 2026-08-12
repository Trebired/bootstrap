# Changelog

All notable changes to `@trebired/bootstrap` will be documented here.

This project follows semantic versioning once published.

## 1.2.8

- Updated the Code Discipline devDependency and lockfile to public `@trebired/code-discipline@^5.5.2`.
- Fixed the public package entrypoint so shutdown controller helpers are exported in the packed runtime.

## 1.2.7

- Adopted the shared Trebired Code Discipline preset so package configs only keep repo-specific policy.
- Updated the Code Discipline devDependency and lockfile to public `@trebired/code-discipline@^5.5.1`.

## 1.2.6

- Updated the package Code Discipline config to the platform-aligned rule set, including formatting, redundant path segment cleanup, removable comment checks, structural blank lines, and dry checks.
- Updated the Code Discipline devDependency and lockfile to the current public `@trebired/code-discipline@^5.3.0`.

## 1.2.5

- Refreshed package dependency ranges and lockfile state with `bun update` after adopting the `.trebired/code-discipline` structure.

## 1.2.4

- Moved Code Discipline config, alias-map state, generated tsconfig paths, and reports to `.trebired/code-discipline/`.
- Updated the `@trebired/code-discipline` devDependency to `^4.10.0`.

## 1.2.3

- Updated Code Discipline configuration to the `imports` rule with dead import removal enabled.
- Updated bootstrap log group metadata fallback so package-owned logs stay under the organization root when package metadata is unavailable.
- Updated internal package dependency ranges to the current published sibling releases.

## 1.2.2

- Fixed a broken published-package build: a fresh checkout has no committed `.code-discipline/generated/` output, and nothing regenerated it before `typecheck`/`build`, so every internal `#hash` import failed to resolve. `typecheck` and `build` now run `prepare:generated` first.
- Standardized package metadata (author field, config-driven organization name, dropped the Node engine constraint) and migrated `.code-discipline/config.ts` to `defineCodeDisciplineConfig`.
- Normalized README structure and removed the license footer.
- Updated the `@trebired/code-discipline` devDependency to 4.8.0.

## 1.2.0

- Added `createBootstrapLifecycleLogger()` for converting structured lifecycle events into logger output with generic normalized metadata and configurable groups/levels.
- Added `createBootstrapShutdownController()` for idempotent lifecycle shutdown requests with degrade, shutdown, optional termination, and separate failure logging.
- Added `bindBootstrapShutdownSignals()` and controller signal binding through injected registration callbacks, without importing Node process globals.
- Added callback-style owned resource cleanup support for methods such as `close(callback)` while preserving sync, promise, timeout, and force cleanup behavior.
- Added runtime verification coverage for lifecycle logging, shutdown controllers, signal binding, and disposable cleanup styles.

## 1.1.7

- Added package-owned organization metadata and derived bootstrap log groups from `package.json`.
- Updated internal package dependency ranges to the current sibling package releases.

## 1.1.6

- Removed dead test scripts and stale test commands from publish workflows and maintainer docs.

## 1.1.5

- Removed package test suites and banned committed `*.spec.ts`/`*.spec.tsx` files through Code Discipline.
- Added Code Discipline enforcement for hardcoded `trebired` strings outside package metadata.
- Migrated Code Discipline to `.code-discipline/config.ts` with alias-map sync output.
- Updated package-generated artifact ignores and internal package dependency ranges.

## 1.1.4

- Moved package-owned bootstrap logging under the `trebired.bootstrap` group root, including initialization, scan, load, and discovery diagnostics.

## 1.1.3

- Added `@trebired/result` as the package-owned backend outcome surface for bootstrap execution paths so internal module coordination no longer rebuilds local result wrappers.
- Enforced the current `@trebired/code-discipline` policy on the touched bootstrap result integration paths and supporting tests without changing the public runtime contract.

## 1.1.2

- fixed the packed package metadata so `main`, `types`, and package-private alias imports resolve to built files that actually exist in the published tarball
- added a publish-preparation step that promotes public `dist/src` entrypoints into `dist`, rewrites compiled alias imports to built relative paths, and rewrites packed `package.json` imports during `npm pack` and `npm publish`
- added explicit pack verification that inspects the tarball and smoke-tests install, typecheck, and runtime import from a clean temporary consumer project

## 1.1.1

- Enforced the package `tb.code-discipline.ts` policy across `src`, `internal`, and other package-owned source folders, including synced import aliases and normalized `tsconfig` path metadata.
- Kept the public bootstrap API and runtime behavior unchanged while bringing the codebase into the current Trebired discipline layout.

## 1.1.0

- Added `createBootstrap()` as a first-class lifecycle runtime with explicit states for `idle`, `bootstrapping`, `ready`, `degrading`, `shutting_down`, `stopped`, and `failed`.
- Added subsystem registration with paired `bootstrap`, `degrade`, and `shutdown` hooks plus dependency-aware ordering.
- Added owned-resource and disposable cleanup through bootstrap contexts with `own(...)` and `addCleanup(...)`.
- Added graceful degradation, safe repeated shutdown calls, shutdown timeouts, forced cleanup reporting, and bootstrap-failure cleanup.
- Added structured lifecycle events for bootstrap, readiness, shutdown, hook execution, forced shutdown, and final stopped state.
- Added lifecycle-aware scanned module support while keeping legacy attach-style bootstrap scanning compatible.
- Added lifecycle documentation, examples, and teardown-focused test coverage.

## 1.0.0

- Added a package startup log through the `bootstrap.initialize` group so `bootstrap()` always emits `@trebired/bootstrap initialized`.

## 0.2.0

- Switched package logger adaptation over to `@trebired/logger-adapter`.
- Added the `loggerAdapter(logger, event)` option for callers who want exact control over the final emitted log structure.

## 0.1.0

- Added a `bootstrap()` public API.
- Added grouped scan options under `scan.dirs` and `scan.files`.
- Added safe default exclusion for `node_modules`, with explicit opt-in through `scan.dirs.allowNodeModules`.
- Renamed the final ordering option from `alphaSuffix` to `lastSuffix`.
- Removed the old nested dependency wrapper. Non-option top-level keys are now injectable dependencies.
- Limited attach-module loading to ESM export shapes only.
- Removed fallback dir discovery. `dir` is now required.
- Split the former monolithic bootstrap implementation into focused core, module, params, scan, logging, and utility modules.
- Added publish-ready package metadata, build exports, README, MIT license, contribution guide, tests, and demo scripts.
- Added a plain `examples/server.js` example with matching bootstrap files.
- Added a summary return value with scanned, loaded, skipped, and failed counts.
- Added bootstrap-specific verbose environment variables and `@trebired/logger`-style logger support.

- Standardized package metadata ordering and contributing guidance around the Trebired writing style.
