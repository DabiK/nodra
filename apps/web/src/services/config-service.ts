import { api } from "../api";

export interface ServerConfig {
  platform: string;
  repositoryRoot: string;
  dataRoot: string;
  workspacesRoot: string;
}

let cached: ServerConfig | null = null;

export async function loadServerConfig(): Promise<ServerConfig> {
  if (cached) return cached;
  cached = await api<ServerConfig>("/api/config");
  return cached;
}

/** Last-known server config, or null before the first fetch resolves. */
export function serverConfig(): ServerConfig | null {
  return cached;
}
