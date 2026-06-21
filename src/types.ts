import type {
  LoggerAdapterEvent,
  LoggerAdapterGenericLogMethod,
  LoggerAdapterLogger,
  LoggerAdapterLogMethod,
  LoggerAdapterWriter,
  NormalizedLoggerAdapter,
} from "@trebired/logger-adapter";

type BootstrapLogMethod = LoggerAdapterLogMethod;
type BootstrapGenericLogMethod = LoggerAdapterGenericLogMethod;
type BootstrapLogger = LoggerAdapterLogger;
type BootstrapLoggerAdapter = LoggerAdapterWriter;
type NormalizedBootstrapLogger = NormalizedLoggerAdapter;
type BootstrapLogEvent = LoggerAdapterEvent;

type LifecycleState =
  | "idle"
  | "bootstrapping"
  | "ready"
  | "degrading"
  | "shutting_down"
  | "stopped"
  | "failed";

type BootstrapPhase = "bootstrap" | "degrade" | "shutdown" | "cleanup";

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

type BootstrapLifecycleEvent = {
  type:
    | "bootstrap:start"
    | "bootstrap:finish"
    | "bootstrap:failure"
    | "readiness:enabled"
    | "readiness:disabled"
    | "shutdown:requested"
    | "hook:start"
    | "hook:finish"
    | "hook:failure"
    | "shutdown:forced"
    | "shutdown:finish";
  timestamp: string;
  state: LifecycleState;
  phase?: BootstrapPhase;
  subsystemId?: string;
  target?: "subsystem" | "resource";
  name?: string;
  durationMs?: number;
  timeoutMs?: number;
  reason?: string;
  readiness?: boolean;
  availability?: boolean;
  error?: unknown;
  summary?: BootstrapSummary;
  report?: BootstrapRunReport | BootstrapShutdownReport | BootstrapDegradeReport;
};

type BootstrapLifecycleListener = (event: BootstrapLifecycleEvent) => void;

type BootstrapLifecycleOptions = {
  shutdownTimeoutMs?: number;
  allowRestart?: boolean;
  onEvent?: BootstrapLifecycleListener;
};

type BootstrapDisposable =
  | (() => unknown)
  | {
    abort?: (...args: unknown[]) => unknown;
    close?: (...args: unknown[]) => unknown;
    destroy?: (...args: unknown[]) => unknown;
    disconnect?: (...args: unknown[]) => unknown;
    dispose?: (...args: unknown[]) => unknown;
    kill?: (...args: unknown[]) => unknown;
    stop?: (...args: unknown[]) => unknown;
    terminate?: (...args: unknown[]) => unknown;
  };

type BootstrapOwnedResourceOptions = {
  name?: string;
  cleanup?: (resource: unknown) => unknown;
  forceCleanup?: (resource: unknown) => unknown;
  timeoutMs?: number;
};

type BootstrapOwnedResourceHandle = {
  name: string;
  dispose: () => Promise<void>;
  unregister: () => void;
};

type BootstrapSubsystemRef = {
  id: string;
  name?: string;
  dependsOn: string[];
};

type BootstrapReadinessController = {
  enable: (reason?: string) => void;
  disable: (reason?: string) => void;
  isReady: () => boolean;
};

type BootstrapAvailabilityController = {
  enable: (reason?: string) => void;
  disable: (reason?: string) => void;
  isAvailable: () => boolean;
};

type BootstrapSnapshot = {
  state: LifecycleState;
  readiness: boolean;
  availability: boolean;
  startedSubsystems: string[];
  failedSubsystems: string[];
  lastSummary: BootstrapSummary;
};

type BootstrapContext = {
  subsystem: BootstrapSubsystemRef;
  deps: Record<string, unknown>;
  signal: AbortSignal;
  own: (resource: BootstrapDisposable | unknown, options?: BootstrapOwnedResourceOptions) => BootstrapOwnedResourceHandle;
  addCleanup: (cleanup: () => unknown | Promise<unknown>, options?: Omit<BootstrapOwnedResourceOptions, "cleanup" | "forceCleanup"> & {
    forceCleanup?: () => unknown | Promise<unknown>;
  }) => BootstrapOwnedResourceHandle;
  readiness: BootstrapReadinessController;
  availability: BootstrapAvailabilityController;
  getState: () => LifecycleState;
  getSnapshot: () => BootstrapSnapshot;
};

type BootstrapDegradeContext = BootstrapContext;
type BootstrapShutdownContext = BootstrapContext;

type BootstrapSubsystemDefinition = {
  id: string;
  name?: string;
  order?: number;
  dependsOn?: string[];
  bootstrap?: (context: BootstrapContext) => unknown | Promise<unknown>;
  shutdown?: (context: BootstrapShutdownContext) => unknown | Promise<unknown>;
  degrade?: (context: BootstrapDegradeContext) => unknown | Promise<unknown>;
};

type BootstrapOptions = {
  dir?: string;
  scan?: BootstrapScanOptions;
  verbose?: boolean;
  logger?: BootstrapLogger;
  loggerAdapter?: BootstrapLoggerAdapter;
  lifecycle?: BootstrapLifecycleOptions;
  subsystems?: BootstrapSubsystemDefinition[];
} & Record<string, unknown>;

type BootstrapSummary = {
  scanned: number;
  loaded: number;
  skipped: number;
  failed: number;
};

type BootstrapRunReport = {
  state: LifecycleState;
  readiness: boolean;
  availability: boolean;
  summary: BootstrapSummary;
  startedSubsystems: string[];
  failedSubsystems: string[];
};

type BootstrapShutdownStepResult = {
  target: "subsystem" | "resource";
  phase: Exclude<BootstrapPhase, "bootstrap">;
  subsystemId: string;
  name: string;
  status: "completed" | "failed" | "timed_out" | "forced";
  durationMs: number;
  error?: unknown;
};

type BootstrapShutdownReport = {
  state: "stopped";
  timeoutMs: number | null;
  reason?: string;
  steps: BootstrapShutdownStepResult[];
  completed: string[];
  failed: string[];
  timedOut: string[];
  forced: string[];
};

type BootstrapDegradeReport = {
  state: LifecycleState;
  reason?: string;
  readiness: boolean;
  availability: boolean;
  steps: BootstrapShutdownStepResult[];
};

type BootstrapShutdownOptions = {
  reason?: string;
  timeoutMs?: number;
};

type BootstrapDegradeOptions = {
  reason?: string;
};

type BootstrapRuntime = {
  registerSubsystem: (definition: BootstrapSubsystemDefinition) => BootstrapRuntime;
  bootstrap: () => Promise<BootstrapRunReport>;
  degrade: (options?: BootstrapDegradeOptions) => Promise<BootstrapDegradeReport>;
  shutdown: (options?: BootstrapShutdownOptions) => Promise<BootstrapShutdownReport>;
  getState: () => LifecycleState;
  getSnapshot: () => BootstrapSnapshot;
  isReady: () => boolean;
  isAvailable: () => boolean;
  onEvent: (listener: BootstrapLifecycleListener) => () => void;
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
  BootstrapAvailabilityController,
  BootstrapContext,
  BootstrapDegradeContext,
  BootstrapDegradeOptions,
  BootstrapDegradeReport,
  BootstrapDirScanOptions,
  BootstrapDisposable,
  BootstrapExportShape,
  BootstrapFileScanOptions,
  BootstrapGenericLogMethod,
  BootstrapHandler,
  BootstrapLifecycleEvent,
  BootstrapLifecycleListener,
  BootstrapLifecycleOptions,
  BootstrapLogEvent,
  BootstrapLogger,
  BootstrapLoggerAdapter,
  BootstrapLogMethod,
  BootstrapOptions,
  BootstrapOwnedResourceHandle,
  BootstrapOwnedResourceOptions,
  BootstrapPhase,
  BootstrapReadinessController,
  BootstrapRunReport,
  BootstrapRuntime,
  BootstrapScanOptions,
  BootstrapShutdownContext,
  BootstrapShutdownOptions,
  BootstrapShutdownReport,
  BootstrapShutdownStepResult,
  BootstrapSnapshot,
  BootstrapSubsystemDefinition,
  BootstrapSubsystemRef,
  BootstrapSummary,
  LifecycleState,
  NormalizedBootstrapLogger,
  ParamBinding,
  ResolvedBootstrapArguments,
  SuffixRules,
};
