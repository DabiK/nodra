export class RuntimeError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
  }
}
