import type { HealthProbe } from "./health-probe.js";

export interface HealthReport {
  service: "nodra";
  status: "ok" | "degraded";
  components: {
    sqlite: { status: "ok" | "error"; detail?: string };
    workflow: { status: "disabled"; detail: string };
    providers: { status: "disabled"; detail: string };
  };
}

export class GetHealth {
  constructor(private readonly database: HealthProbe) {}

  async execute(): Promise<HealthReport> {
    const sqlite = await this.database.check();
    return {
      service: "nodra",
      status: sqlite.status === "ok" ? "ok" : "degraded",
      components: {
        sqlite,
        workflow: {
          status: "disabled",
          detail: "Temporal runtime is deliberately absent from this increment"
        },
        providers: {
          status: "disabled",
          detail: "Provider runtimes are deliberately absent from this increment"
        }
      }
    };
  }
}
