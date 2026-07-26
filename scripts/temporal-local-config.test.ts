import { describe, expect, it } from "vitest";
import { readTemporalLocalConfig } from "./temporal-local-config.js";

describe("Temporal local configuration", () => {
  it("derives both dev databases from an explicit data root", () => {
    expect(readTemporalLocalConfig({
      NODRA_DATA_ROOT: "/tmp/nodra-i6-2",
      NODRA_TEMPORAL_ADDRESS: "localhost:17333",
      NODRA_TEMPORAL_NAMESPACE: "nodra",
      NODRA_DATABASE_FILE: "/tmp/nodra-i6-2/business.db"
    }, "/unused")).toEqual({
      address: "localhost:17333",
      databaseFile: "/tmp/nodra-i6-2/business.db",
      dataRoot: "/tmp/nodra-i6-2",
      ip: "127.0.0.1",
      namespace: "nodra",
      port: 17_333,
      temporalDatabaseFile: "/tmp/nodra-i6-2/temporal/dev-server.db"
    });
  });

  it("refuses a non-loopback Temporal address", () => {
    expect(() => readTemporalLocalConfig({
      NODRA_TEMPORAL_ADDRESS: "temporal.example.com:7233"
    })).toThrow("must use loopback");
  });
});
