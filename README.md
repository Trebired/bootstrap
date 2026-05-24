# @trebired/bootstrap

A backend bootstrap loader for Bun and Node.js that discovers modules, runs them in order, and injects dependencies by parameter name.

`@trebired/bootstrap` scans a bootstrap directory, finds ordered bootstrap files, injects your dependencies by parameter name, and runs each bootstrap module in a stable order.

## Install

Runtime support: Bun 1+ and Node.js 18+.

Bun can import `.ts` and `.mts` bootstrap files directly. Node.js users should point `dir` at compiled ESM `.js` or `.mjs` output, or run Node with a TypeScript loader.

```sh
npm install @trebired/bootstrap
```

## Quick Start

```ts
import { bootstrap } from "@trebired/bootstrap";
import { createLog } from "@trebired/logger";

const log = createLog({
  console: true,
  quiet: true,
  save: false,
});

await bootstrap({
  dir: "/srv/app/src/backend",
  config,
  db,
  log,
  logger: log,
});
```

`dir` is required. There is no fallback search path.

## What It Loads

Bootstrap starts at the `dir` you pass in and only scans directories under that path.

It does this:

- reads the first-level child directories inside `dir`
- walks those directories recursively
- only considers `.js`, `.mjs`, `.ts`, and `.mts` files
- only runs files whose names end with a numeric suffix like `.1`, `.2`, `.3`, or a final suffix like `.a`

It does not do this:

- it does not scan files sitting directly in the root `dir`
- it does not load `.cjs` files
- it does not guess names like `server`, `io`, or `app`

Example:

```txt
src/backend/
  db/
    connect.1.ts
    migrate.2.ts
    ready.a.ts
    helper.ts
  http/
    middleware.1.ts
  jobs/
    queue.1.ts
  root-file.1.ts
```

Loaded:

- `db/connect.1.ts`
- `db/migrate.2.ts`
- `db/ready.a.ts`
- `http/middleware.1.ts`
- `jobs/queue.1.ts`

Ignored:

- `db/helper.ts`
  It has no ordering suffix.
- `root-file.1.ts`
  It sits directly in `dir`, and bootstrap only starts from child directories.

Order is simple:

- numbered files run first in ascending order
- the final suffix runs after the numbered files

With the default final suffix, `ready.a.ts` runs after `connect.1.ts` and `migrate.2.ts`.

## Module Shapes

Each bootstrap file must be an ESM module and can export one of these shapes:

```ts
export default function attach(db, log) {
  log.info("db", "connected");
}
```

```ts
export function attach(dependencies) {
  dependencies.log.info("http", "middleware attached");
}
```

```ts
export default {
  attach(config, db) {
    db.configure(config.database);
  },
};
```

CommonJS patterns such as `module.exports = ...` are not supported.

About the `attach` name:

- if you use a named export hook, it must be named `attach`
- if you use a default exported object hook, the method must be named `attach`
- if you use a default exported function, the function does not need to be named `attach`

So this works:

```ts
export default function startServer(app, log) {
  log.info("http", "server starting");
}
```

and this works:

```ts
export function attach(app, log) {
  log.info("http", "routes attached");
}
```

but this does not:

```ts
export function start(app, log) {
  log.info("http", "routes attached");
}
```

## How Dependencies Work

Every non-option top-level key you pass into `bootstrap()` becomes injectable by parameter name.

This:

```ts
await bootstrap({
  dir: "/srv/app/src/backend",
  config,
  db,
  log,
  logger: log,
});
```

lets a bootstrap file do this:

```ts
export default function connect(config, db, log) {
  log.info("db", "connected");
}
```

If a bootstrap file wants the whole dependency object, use `dependencies` or `deps`:

```ts
export function attach(dependencies) {
  dependencies.log.info("http", "middleware attached");
}
```

There are no hardcoded dependency names. `server`, `io`, `app`, `config`, `db`, `log`, or any other name only exist if you pass them in.

Reserved option keys are `dir`, `scan`, `verbose`, and `logger`. If you want your bootstrap files to receive a logger dependency, pass it as `log` and also set `logger: log` if you want bootstrap itself to use the same logger.

## Scan Config

The public scan config is grouped so it is clearer what applies to directories and what applies to files.

```ts
await bootstrap({
  dir: "/srv/app/src/backend",
  config,
  db,
  log,
  logger: log,
  scan: {
    dirs: {
      include: ["db", "http", "jobs"],
      exclude: ["legacy", "db/fixtures"],
      allowNodeModules: false,
    },
    files: {
      include: ["connect.1.ts", "http/routes.2.ts"],
      exclude: ["types.d.ts", "http/legacy.3.ts"],
      excludeSuffixes: ["spec", "test", "d"],
      lastSuffix: "a",
    },
  },
  verbose: true,
});
```

What each option means:

- `dir`: required root directory to scan
- `config`, `db`, `log`, and other non-option keys: dependencies that bootstrap files can request by parameter name
- `scan.dirs.include`: first-level folders under `dir` to start scanning from
- `scan.dirs.exclude`: directories to skip by basename or relative path
- `scan.dirs.allowNodeModules`: `false` by default, so `node_modules` is skipped unless you explicitly allow it
- `scan.files.include`: optional allowlist for files, matched by basename or relative path
- `scan.files.exclude`: files to skip by basename or relative path
- `scan.files.excludeSuffixes`: suffixes to ignore, such as `spec`, `test`, or `d`
- `scan.files.lastSuffix`: the suffix that runs last after numbered files
- `verbose`: prints extra bootstrap diagnostics
- `logger`: logger used by bootstrap's own internal messages

Some concrete examples:

- `scan.dirs.include: ["db", "http"]` means bootstrap starts only from `/srv/app/src/backend/db` and `/srv/app/src/backend/http`
- `scan.dirs.exclude: ["legacy", "db/fixtures"]` skips a directory literally named `legacy`, and also skips the specific relative path `db/fixtures`
- `scan.dirs.allowNodeModules: true` is the explicit opt-in if you really want bootstrap to scan a `node_modules` directory
- `scan.files.include: ["routes.2.ts", "http/server.a.ts"]` matches by either basename or relative path
- `scan.files.exclude: ["types.d.ts", "http/legacy.3.ts"]` also matches by either basename or relative path
- `scan.files.lastSuffix: "a"` means `ready.a.ts` runs after `connect.1.ts` and `migrate.2.ts`

When `scan.files.include` is present, it acts as an allowlist. Only matching supported files are considered, and only attachable files actually run.

For safety, `node_modules` is excluded by default anywhere in the scan tree. If you really want to scan it, set `scan.dirs.allowNodeModules: true`.

## Full API Example

```ts
import { bootstrap } from "@trebired/bootstrap";
import { createLog } from "@trebired/logger";

const log = createLog({
  console: true,
  quiet: true,
  save: false,
});

const summary = await bootstrap({
  dir: "/srv/app/src/backend",
  config,
  db,
  log,
  cache,
  http,
  scan: {
    dirs: {
      include: ["db", "http", "jobs"],
      exclude: ["legacy", "jobs/fixtures"],
      allowNodeModules: false,
    },
    files: {
      include: ["connect.1.ts", "http/routes.2.ts", "jobs/ready.a.ts"],
      exclude: ["types.d.ts", "http/legacy.3.ts"],
      excludeSuffixes: ["spec", "test", "d"],
      lastSuffix: "a",
    },
  },
  verbose: true,
  logger: log,
});

log.info("bootstrap", "startup complete", summary);
```

That example means:

- bootstrap scans `/srv/app/src/backend`
- only the `db`, `http`, and `jobs` root folders are used as scan starting points
- `legacy` directories and `jobs/fixtures` are skipped
- only files that match the file allowlist are considered
- files ending in `.spec`, `.test`, or `.d` are ignored
- files ending in `.a` run after numbered files
- bootstrap's internal diagnostics are sent through the same `log` object

## Logger Support

`@trebired/bootstrap` works best with `@trebired/logger`, and that is the recommended logger.

Why we recommend it:

- it is simple
- it already matches bootstrap's expected method shape
- it keeps application logs and bootstrap logs in one consistent format

The logger style:

```ts
log.info("bootstrap", "startup complete", summary);
```

comes from `@trebired/logger`.

If you pass `logger: log`, bootstrap will use that same style for its internal messages.

If you do not pass a logger and `@trebired/logger` is installed in the host app, bootstrap will create a quiet console-only logger automatically before falling back to raw `console`.

If you want bootstrap files themselves to receive the logger as a dependency, also pass it as a normal top-level dependency:

```ts
await bootstrap({
  dir,
  log,
  logger: log,
});
```

Custom loggers can also use one of these shapes:

```ts
type Logger = {
  info(group: string, message: string, metadata?: unknown): void;
  warn(group: string, message: string, metadata?: unknown): void;
  error(group: string, message: string, metadata?: unknown): void;
  fail(group: string, message: string, metadata?: unknown): void;
};

type Event = {
  level: "info" | "warn" | "error" | "fail";
  group: string;
  message: string;
  metadata?: unknown;
};

type EventLogger = (event: Event) => void;

type SinkLogger = {
  log?(event: Event): void;
  write?(event: Event): void;
  fatal?(message: string, metadata?: unknown): void;
};
```

What those parts mean:

- `group`: the category or source, such as `"bootstrap"` or `"http"`
- `message`: a short event description
- `metadata`: optional extra data, usually an object

Common logger objects such as `console`, pino-style level methods, or Winston-style sinks are also adapted as sensibly as possible.

If no logger is provided and `@trebired/logger` is not installed, bootstrap falls back to plain `console` output.

## Example App

There is a working example in [examples/server.js](./examples/server.js) with matching bootstrap files under [examples/server_bootstrap](./examples/server_bootstrap).

That example shows:

- a small app object being built in ordered bootstrap files
- top-level dependency injection
- using the same `log` object for both injected logging and bootstrap's own internal logging

## Return Value

`bootstrap()` returns a summary object:

```ts
type BootstrapSummary = {
  scanned: number;
  loaded: number;
  skipped: number;
  failed: number;
};
```
