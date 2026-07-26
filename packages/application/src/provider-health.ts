import type { ProviderCapabilities, ProviderHealth } from "./provider-model.js";

export const deriveProviderHealth = (
  capabilities: ProviderCapabilities
): ProviderHealth => {
  if (!capabilities.availability.available) {
    return {
      status: "unavailable",
      reason: capabilities.availability.reason,
      actionRequired: "install_or_start_binary"
    };
  }
  if (capabilities.contract.status === "incompatible") {
    return {
      status: "degraded",
      reason: "protocol_incompatible",
      actionRequired: "update_required"
    };
  }
  if (!capabilities.authentication.available) {
    return {
      status: "degraded",
      reason: capabilities.authentication.reason,
      actionRequired: "authenticate"
    };
  }
  if (!capabilities.models.available) {
    return {
      status: "degraded",
      reason: capabilities.models.reason,
      actionRequired: "discover_models"
    };
  }
  if (capabilities.contract.status === "compatible_unverified") {
    return {
      status: "degraded",
      reason: capabilities.contract.reason,
      actionRequired: "update_required"
    };
  }
  return { status: "ready", reason: null, actionRequired: null };
};
