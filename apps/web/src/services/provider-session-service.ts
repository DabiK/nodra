import { api } from "../api";
import type { ProviderSessionCapabilities, ProviderSessionDetailView, ProviderSessionListView } from "../types";
import { providerLabel } from "./provider-label";

export class ProviderSessionRequestError extends Error {
  constructor(operation: string) {
    super(`Impossible de ${operation}.`);
    this.name = "ProviderSessionRequestError";
  }
}

async function request<T>(operation: string, path: string, init?: RequestInit): Promise<T> {
  try {
    return await api<T>(path, init);
  } catch {
    throw new ProviderSessionRequestError(operation);
  }
}

export function getProviderSessionCapabilities(providerId: string) {
  return request<ProviderSessionCapabilities>(`lire les capacités ${providerLabel(providerId)}`, `/api/provider-sessions/capabilities?providerId=${encodeURIComponent(providerId)}`);
}

export function listProviderSessions(providerId: string) {
  return request<ProviderSessionListView>(`charger les sessions ${providerLabel(providerId)}`, `/api/provider-sessions?providerId=${encodeURIComponent(providerId)}&limit=40`);
}

export function showProviderSession(sessionId: string) {
  return request<ProviderSessionDetailView>("charger la session", `/api/provider-sessions/${encodeURIComponent(sessionId)}`);
}

export function refreshProviderSession(sessionId: string) {
  return request<ProviderSessionDetailView>("rafraîchir la session", `/api/provider-sessions/${encodeURIComponent(sessionId)}/refresh`, { method: "POST", body: "{}" });
}

export function attachProviderSession(sessionId: string, input: { missionId: string; commandId: string }) {
  return request("rattacher la session", `/api/provider-sessions/${encodeURIComponent(sessionId)}/attach`, {
    method: "POST", body: JSON.stringify({ ...input, mode: "read_only" })
  });
}

export function createProviderSessionMission(sessionId: string, input: { title: string; projectId?: string; commandId: string }) {
  return request("créer une mission pour la session", `/api/provider-sessions/${encodeURIComponent(sessionId)}/missions`, {
    method: "POST", body: JSON.stringify({ ...input, mode: "read_only" })
  });
}
