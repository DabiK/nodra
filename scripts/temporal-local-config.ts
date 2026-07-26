import { resolve } from "node:path";

export interface TemporalLocalConfig {
  address: string;
  databaseFile: string;
  dataRoot: string;
  ip: "127.0.0.1";
  namespace: string;
  port: number;
  temporalDatabaseFile: string;
}

const parseLoopbackAddress = (address: string): { ip: "127.0.0.1"; port: number } => {
  const match = /^(127\.0\.0\.1|localhost):(\d+)$/.exec(address);
  if (!match) {
    throw new Error("NODRA_TEMPORAL_ADDRESS must use loopback as 127.0.0.1:<port> or localhost:<port>");
  }
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("NODRA_TEMPORAL_ADDRESS contains an invalid port");
  }
  return { ip: "127.0.0.1", port };
};

export const readTemporalLocalConfig = (
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd()
): TemporalLocalConfig => {
  const address = environment.NODRA_TEMPORAL_ADDRESS ?? "127.0.0.1:7233";
  const { ip, port } = parseLoopbackAddress(address);
  const namespace = environment.NODRA_TEMPORAL_NAMESPACE?.trim() || "nodra";
  const dataRoot = resolve(environment.NODRA_DATA_ROOT ?? `${workingDirectory}/data/dev`);
  const databaseFile = resolve(environment.NODRA_DATABASE_FILE ?? `${dataRoot}/nodra.db`);
  return {
    address,
    databaseFile,
    dataRoot,
    ip,
    namespace,
    port,
    temporalDatabaseFile: resolve(dataRoot, "temporal/dev-server.db")
  };
};
