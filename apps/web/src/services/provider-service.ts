import { api } from "../api";
import type { ProviderOptionsCatalog } from "../types";

export const reasoningLabels: Record<string, string> = {
  provider_default: "Provider default",
  minimal: "Minimal",
  low: "Léger",
  medium: "Moyen",
  high: "Élevé",
  xhigh: "Maximum"
};

export const permissionLabels: Record<string, string> = {
  read_only: "Read only",
  workspace: "Workspace write",
  full_access: "Full access"
};

export async function loadProviderOptions() {
  return api<ProviderOptionsCatalog>("/api/providers/options");
}

export async function probeProvider(providerId: string) {
  await api(`/api/providers/${providerId}/probe`, {
    method: "POST",
    body: JSON.stringify({ optIn: true })
  });
  return loadProviderOptions();
}

export function selectDefaultModel(catalog: ProviderOptionsCatalog, providerId: string) {
  const provider = catalog.providers.find((item) => item.id === providerId);
  return provider?.models.find((model) => model.isDefault)?.id
    ?? provider?.models[0]?.id
    ?? catalog.defaults.modelId;
}
