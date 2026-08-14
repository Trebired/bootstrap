import type {
  BootstrapLifecycleOptions,
  BootstrapOptions,
  BootstrapScanOptions,
} from "#63np0sf1s6f9";

type BootstrapConfig = {
  dir?: string;
  lifecycle?: Omit<BootstrapLifecycleOptions, "onEvent">;
  scan?: BootstrapScanOptions;
  verbose?: boolean;
};

type NormalizedBootstrapConfig = {
  dir?: string;
  lifecycle?: Omit<BootstrapLifecycleOptions, "onEvent">;
  scan?: BootstrapScanOptions;
  verbose?: boolean;
};

type LoadedBootstrapConfig = {
  config: NormalizedBootstrapConfig;
  configPath: string | null;
  dependencies: string[];
};

type LoadBootstrapConfigOptions = {
  configPath?: string;
  defaultIfMissing?: boolean;
  searchFrom?: string;
};

type BootstrapConfigurableOptions = Pick<BootstrapOptions, "dir"|"lifecycle"|"scan"|"verbose">;

export type {
  BootstrapConfig,
  BootstrapConfigurableOptions,
  LoadBootstrapConfigOptions,
  LoadedBootstrapConfig,
  NormalizedBootstrapConfig,
};
