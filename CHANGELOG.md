# Changelog

All notable changes to `@trebired/bootstrap` will be documented here.

This project follows semantic versioning once published.

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
