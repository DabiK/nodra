export interface RuntimeHealthProbe {
  check(): Promise<{ status: "ok" | "error"; detail?: string }>;
}
