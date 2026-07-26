import type { CodexJsonRpcClient } from "./codex-json-rpc-client.js";

export interface ActiveCodexRun {
  client: CodexJsonRpcClient;
  binaryVersion: string | null;
  threadId: string | null;
  turnId: string | null;
}

export class CodexProcessSupervisor {
  private readonly runs = new Map<string, ActiveCodexRun>();

  attach(runId: string, client: CodexJsonRpcClient): ActiveCodexRun {
    if (this.runs.has(runId)) throw new Error(`Provider process already exists for run ${runId}`);
    const active = { client, binaryVersion: null, threadId: null, turnId: null };
    this.runs.set(runId, active);
    return active;
  }

  get(runId: string): ActiveCodexRun | null {
    return this.runs.get(runId) ?? null;
  }

  release(runId: string): void {
    const active = this.runs.get(runId);
    active?.client.close();
    this.runs.delete(runId);
  }
}
