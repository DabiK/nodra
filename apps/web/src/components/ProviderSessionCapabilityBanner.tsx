import type { ProviderSessionCapabilities } from "../types";
import { providerLabel } from "../services/provider-label";

export function ProviderSessionCapabilityBanner({ capabilities, providerId }: { capabilities: ProviderSessionCapabilities | null; providerId: string }) {
  if (!capabilities) return null;
  const label = providerLabel(providerId);
  const unavailable = [capabilities.listSessions, capabilities.readSession].filter((item) => item.state === "unavailable");
  const unverified = [capabilities.listSessions, capabilities.readSession].filter((item) => item.state === "compatible_unverified");
  if (unavailable.length) {
    return <p className="provider-session-capability unavailable" role="alert">Lecture indisponible chez {label}. {unavailable[0].reason ?? "La capacité requise n’est pas disponible."}</p>;
  }
  if (unverified.length) {
    return <p className="provider-session-capability" role="status">Compatibilité {label} non certifiée : lecture disponible avec prudence.</p>;
  }
  return <p className="provider-session-capability certified" role="status">Lecture {label} certifiée. Les contrôles et le direct restent indisponibles.</p>;
}
