import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface CliRuntimeEnvironment {
  databaseFile: string;
  dataRoot: string;
  temporalAddress: string;
  temporalNamespace: string;
}

export const readRuntimeEnvironment = (
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv = process.env
): CliRuntimeEnvironment => {
  const fallbackDataRoot = resolve(repositoryRoot, "data/local");
  const fallback = {
    databaseFile: resolve(repositoryRoot, "data/nodra.db"),
    dataRoot: fallbackDataRoot,
    temporalAddress: environment.NODRA_TEMPORAL_ADDRESS ?? "127.0.0.1:7233",
    temporalNamespace: environment.NODRA_TEMPORAL_NAMESPACE ?? "nodra"
  };
  const shouldReadRuntimeManifest = Boolean(environment.NODRA_RUNTIME_ROOT) || !environment.NODRA_DATABASE_FILE;
  const runtimeRoot = resolve(environment.NODRA_RUNTIME_ROOT ?? `${fallbackDataRoot}/runtime`);
  if (!shouldReadRuntimeManifest) {
    const databaseFile = environment.NODRA_DATABASE_FILE;
    if (!databaseFile) return fallback;
    return {
      databaseFile,
      dataRoot: environment.NODRA_DATA_ROOT ?? fallback.dataRoot,
      temporalAddress: environment.NODRA_TEMPORAL_ADDRESS ?? fallback.temporalAddress,
      temporalNamespace: environment.NODRA_TEMPORAL_NAMESPACE ?? fallback.temporalNamespace
    };
  }
  try {
    const manifest = JSON.parse(readFileSync(`${runtimeRoot}/runtime-state.json`, "utf8")) as {
      databaseFile?: unknown;
      dataRoot?: unknown;
      temporalNamespace?: unknown;
      components?: {
        temporal?: { address?: unknown };
        opencode?: { url?: unknown };
        api?: { url?: unknown };
      };
    };
    const opencodeUrl = manifest.components?.opencode?.url;
    if (!environment.NODRA_OPENCODE_URL && typeof opencodeUrl === "string") {
      environment.NODRA_OPENCODE_URL = opencodeUrl;
    }
    const apiUrl = manifest.components?.api?.url;
    if (!environment.NODRA_API_URL && typeof apiUrl === "string") {
      environment.NODRA_API_URL = apiUrl;
    }
    const manifestFound = typeof manifest.databaseFile === "string";
    return {
      databaseFile: manifestFound
        ? manifest.databaseFile as string
        : environment.NODRA_DATABASE_FILE ?? fallback.databaseFile,
      dataRoot: typeof manifest.dataRoot === "string"
        ? manifest.dataRoot
        : environment.NODRA_DATA_ROOT ?? fallback.dataRoot,
      temporalAddress: typeof manifest.components?.temporal?.address === "string"
        ? manifest.components.temporal.address
        : environment.NODRA_TEMPORAL_ADDRESS ?? fallback.temporalAddress,
      temporalNamespace: typeof manifest.temporalNamespace === "string"
        ? manifest.temporalNamespace
        : environment.NODRA_TEMPORAL_NAMESPACE ?? fallback.temporalNamespace
    };
  } catch {
    return {
      databaseFile: environment.NODRA_DATABASE_FILE ?? fallback.databaseFile,
      dataRoot: environment.NODRA_DATA_ROOT ?? fallback.dataRoot,
      temporalAddress: environment.NODRA_TEMPORAL_ADDRESS ?? fallback.temporalAddress,
      temporalNamespace: environment.NODRA_TEMPORAL_NAMESPACE ?? fallback.temporalNamespace
    };
  }
};
