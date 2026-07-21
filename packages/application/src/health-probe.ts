export interface HealthProbe {
  check(): Promise<{ status: "ok" | "error"; detail?: string }>;
}
