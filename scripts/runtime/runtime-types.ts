export type RuntimeComponentName = "temporal" | "opencode" | "api" | "worker";
export type RuntimeOwnership = "managed" | "external";
export type RuntimeHealthState = "ready" | "degraded" | "stopped" | "stale";

export interface RuntimeProcessIdentity {
  pid: number;
  pgid: number;
  startedAt: string;
  command: string;
  signature: string;
}

export interface RuntimeComponentManifest {
  name: RuntimeComponentName;
  ownership: RuntimeOwnership;
  identity: RuntimeProcessIdentity | null;
  address: string | null;
  port: number | null;
  url: string | null;
  logFile: string | null;
  health: RuntimeHealthState;
  detail: string | null;
}

export interface RuntimeManifest {
  schemaVersion: 1;
  runtimeId: string;
  repositoryRoot: string;
  runtimeRoot: string;
  dataRoot: string;
  databaseFile: string;
  profile: "local" | "user";
  temporalNamespace: string;
  createdAt: string;
  updatedAt: string;
  ownerPid: number;
  components: Record<RuntimeComponentName, RuntimeComponentManifest>;
}

export interface RuntimeConfiguration {
  repositoryRoot: string;
  runtimeRoot: string;
  dataRoot: string;
  databaseFile: string;
  profile: "local" | "user";
  temporalAddress: string | null;
  temporalNamespace: string;
  opencodeUrl: string | null;
  apiUrl: string | null;
  temporalBinary: string;
  opencodeBinary: string;
  tsxBinary: string;
  opencodeConfigFile: string | null;
  ollamaUrl: string;
  localModel: string;
  stopTimeoutMs: number;
}

export interface RuntimeStatus {
  runtimeRoot: string;
  manifest: RuntimeManifest | null;
  overall: RuntimeHealthState;
  components: RuntimeComponentManifest[];
  environment: Record<string, string>;
}

export interface DoctorCheck {
  name: string;
  status: "ok" | "warning" | "error";
  detail: string;
}

export interface DoctorReport {
  ready: boolean;
  profile: "local" | "user";
  checks: DoctorCheck[];
}
