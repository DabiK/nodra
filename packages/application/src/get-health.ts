import type { HealthProbe } from "./health-probe.js";
import type {
  ProviderComponentHealth,
  ProviderHealthProbe
} from "./provider-health-probe.js";
import type { RuntimeHealthProbe } from "./runtime-health-probe.js";

export interface HealthReport {
  service: "nodra";
  status: "ok" | "degraded";
  components: {
    sqlite: { status: "ok" | "error"; detail?: string };
    workflow: { status: "ok" | "error"; detail?: string };
    providers: ProviderComponentHealth;
  };
}

export class GetHealth {
  constructor(
    private readonly database: HealthProbe,
    private readonly workflow: RuntimeHealthProbe,
    private readonly providers?: ProviderHealthProbe
  ) {}

  async execute(): Promise<HealthReport> {
    const [sqlite, workflow, providers] = await Promise.all([
      this.database.check(),
      this.workflow.check(),
      this.providers?.check() ?? Promise.resolve({
        providerId: "unconfigured",
        status: "unconfigured" as const,
        reason: "no_explicit_probe",
        action: null
      })
    ]);
    return {
      service: "nodra",
      status: sqlite.status === "ok" && workflow.status === "ok" && providers.status === "ok"
        ? "ok"
        : "degraded",
      components: {
        sqlite,
        workflow,
        providers
      }
    };
  }
}
