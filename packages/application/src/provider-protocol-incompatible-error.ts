export class ProviderProtocolIncompatibleError extends Error {
  readonly code = "PROVIDER_PROTOCOL_INCOMPATIBLE";

  constructor(
    message: string,
    readonly providerId: string,
    readonly currentVersion: string | null
  ) {
    super(message);
    this.name = "ProviderProtocolIncompatibleError";
  }
}
