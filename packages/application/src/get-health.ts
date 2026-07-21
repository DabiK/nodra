import type { HealthProbe } from "./health-probe.js";
import type { RuntimeHealthProbe } from "./runtime-health-probe.js";

export interface HealthReport {
  service: "nodra";
  status: "ok" | "degraded";
  components: {
    sqlite: { status: "ok" | "error"; detail?: string };
    workflow: { status: "ok" | "error"; detail?: string };
    providers: { status: "disabled"; detail: string };
  };
}

export class GetHealth {
  constructor(
    private readonly database: HealthProbe,
    private readonly workflow: RuntimeHealthProbe
  ) {}

  async execute(): Promise<HealthReport> {
    const [sqlite, workflow] = await Promise.all([this.database.check(), this.workflow.check()]);
    return {
      service: "nodra",
      status: sqlite.status === "ok" && workflow.status === "ok" ? "ok" : "degraded",
      components: {
        sqlite,
        workflow,
        providers: {
          status: "disabled",
          detail: "Provider runtimes are deliberately absent from this increment"
        }
      }
    };
  }
}
