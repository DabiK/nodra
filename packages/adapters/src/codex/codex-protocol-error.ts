export class CodexProtocolError extends Error {
  constructor(
    message: string,
    readonly code = "CODEX_PROTOCOL_ERROR",
    readonly remoteCode: number | null = null
  ) {
    super(message);
    this.name = "CodexProtocolError";
  }
}
