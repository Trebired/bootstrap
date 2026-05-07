# Changelog

All notable changes to `@trebired/bootstrap` will be documented here.

This project follows semantic versioning once published.

## 0.1.0

- Renamed the package from `@trebired/loader` to `@trebired/bootstrap`.
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
