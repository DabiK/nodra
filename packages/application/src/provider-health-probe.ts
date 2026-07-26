export interface ProviderComponentHealth {
  providerId: string;
  status: "ok" | "degraded" | "unconfigured";
  reason: string | null;
  action: string | null;
}

export interface ProviderHealthProbe {
  check(): Promise<ProviderComponentHealth>;
}
