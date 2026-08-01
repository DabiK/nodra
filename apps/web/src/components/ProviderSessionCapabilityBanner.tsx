import type { ProviderSessionCapabilities } from "../types";

export function ProviderSessionCapabilityBanner({ capabilities }: { capabilities: ProviderSessionCapabilities | null }) {
  if (!capabilities) return null;
  const unavailable = [capabilities.listSessions, capabilities.readSession].filter((item) => item.state === "unavailable");
  const unverified = [capabilities.listSessions, capabilities.readSession].filter((item) => item.state === "compatible_unverified");
  if (unavailable.length) {
    return <p className="provider-session-capability unavailable" role="alert">Lecture indisponible chez Codex. {unavailable[0].reason ?? "La capacité requise n’est pas disponible."}</p>;
  }
  if (unverified.length) {
    return <p className="provider-session-capability" role="status">Compatibilité Codex non certifiée : lecture disponible avec prudence.</p>;
  }
  return <p className="provider-session-capability certified" role="status">Lecture Codex certifiée. Les contrôles et le direct restent indisponibles.</p>;
}
