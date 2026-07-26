import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { CodexProtocolError } from "./codex-protocol-error.js";
import {
  isRecord,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcRequest
} from "./codex-json-rpc-types.js";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export type ServerRequestHandler = (request: JsonRpcRequest) => Promise<unknown>;
export type NotificationHandler = (method: string, params: unknown) => Promise<void>;

export class CodexJsonRpcClient {
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private closedError: Error | null = null;
  private requestHandler: ServerRequestHandler = async (request) => {
    throw new CodexProtocolError(`Unsupported server request ${request.method}`, "CODEX_REQUEST_UNSUPPORTED");
  };
  private notificationHandler: NotificationHandler = async () => undefined;
  private failureHandler: (error: Error) => void = () => undefined;
  private notificationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly process: ChildProcessWithoutNullStreams) {
    const lines = createInterface({ input: process.stdout });
    process.stderr.resume();
    lines.on("line", (line) => this.receiveLine(line));
    process.once("error", (error) => {
      const code = (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "CODEX_BINARY_NOT_FOUND"
        : "CODEX_PROCESS_ERROR";
      this.fail(new CodexProtocolError(
        `Codex app-server process failed: ${error.message}`,
        code
      ));
    });
    process.once("exit", (code, signal) => this.fail(new CodexProtocolError(
      `Codex app-server exited before client close (code=${String(code)}, signal=${String(signal)})`,
      "CODEX_PROCESS_EXIT"
    )));
  }

  onServerRequest(handler: ServerRequestHandler): void {
    this.requestHandler = handler;
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  onFailure(handler: (error: Error) => void): void {
    this.failureHandler = handler;
  }

  async initialize(): Promise<Record<string, unknown>> {
    const result = await this.request("initialize", {
      clientInfo: { name: "nodra", title: "Nodra", version: "0.1.0" }
    });
    this.notify("initialized", {});
    if (!isRecord(result)) throw new CodexProtocolError("initialize returned an invalid result");
    return result;
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (this.closedError) return Promise.reject(this.closedError);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ method, id, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  close(): void {
    this.closedError = new CodexProtocolError("Codex app-server client closed", "CODEX_PROCESS_CLOSED");
    this.process.kill("SIGTERM");
    this.rejectPending(this.closedError);
  }

  private receiveLine(line: string): void {
    if (this.closedError) return;
    let message: JsonRpcMessage;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed)) throw new Error("message is not an object");
      message = parsed as unknown as JsonRpcMessage;
    } catch {
      this.fail(new CodexProtocolError("Codex app-server emitted malformed JSONL"));
      return;
    }
    if ("id" in message && ("result" in message || "error" in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        this.fail(new CodexProtocolError(`Codex app-server returned unknown response id ${String(message.id)}`));
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new CodexProtocolError(
          `Codex app-server ${message.error.code}: ${message.error.message}`,
          "CODEX_REMOTE_ERROR",
          message.error.code
        ));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (!("method" in message) || typeof message.method !== "string") {
      this.fail(new CodexProtocolError("Codex app-server emitted an invalid message"));
      return;
    }
    if ("id" in message) {
      void this.answerServerRequest(message as JsonRpcRequest);
      return;
    }
    this.notificationQueue = this.notificationQueue
      .then(() => this.notificationHandler(message.method, message.params))
      .catch((error: unknown) => {
        this.fail(error instanceof Error ? error : new CodexProtocolError("Notification handler failed"));
      });
  }

  private async answerServerRequest(request: JsonRpcRequest): Promise<void> {
    try {
      const result = await this.requestHandler(request);
      this.write({ id: request.id, result });
    } catch (error) {
      this.write({
        id: request.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : "Nodra rejected the provider request"
        }
      });
    }
  }

  private write(message: unknown): void {
    if (this.closedError) throw this.closedError;
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private fail(error: Error): void {
    if (this.closedError) return;
    this.closedError = error;
    this.failureHandler(error);
    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
