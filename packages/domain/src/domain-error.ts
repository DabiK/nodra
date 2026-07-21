export class DomainError extends Error {
  constructor(message: string, readonly code = "DOMAIN_ERROR") {
    super(message);
    this.name = "DomainError";
  }
}
