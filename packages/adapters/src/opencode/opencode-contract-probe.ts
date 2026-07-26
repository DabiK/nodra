import { createHash } from "node:crypto";

export interface OpenCodeContractSnapshot {
  healthy: boolean;
  version: string;
  digest: string;
  document: string;
  requiredPrimitives: Readonly<Record<string, boolean>>;
}

const requiredPaths = [
  ["get", "/global/health"],
  ["get", "/config/providers"],
  ["post", "/session"],
  ["get", "/session/{}/message"],
  ["post", "/session/{}/prompt_async"],
  ["post", "/session/{}/abort"],
  ["post", "/session/{}/permissions/{}"],
  ["get", "/event"]
] as const;

export class OpenCodeContractProbe {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImplementation: typeof fetch = fetch
  ) {}

  async execute(): Promise<OpenCodeContractSnapshot> {
    const healthResponse = await this.fetchImplementation(`${this.baseUrl}/global/health`);
    if (!healthResponse.ok) {
      throw new Error(`OpenCode health returned HTTP ${healthResponse.status}`);
    }
    const health: unknown = await healthResponse.json();
    if (!this.isRecord(health) || health.healthy !== true || typeof health.version !== "string") {
      throw new Error("OpenCode health response is incompatible");
    }
    const documentResponse = await this.fetchImplementation(`${this.baseUrl}/doc`, {
      headers: { accept: "application/json, text/html;q=0.9" }
    });
    if (!documentResponse.ok) {
      throw new Error(`OpenCode /doc returned HTTP ${documentResponse.status}`);
    }
    const document = await documentResponse.text();
    if (!document.trim()) throw new Error("OpenCode /doc returned an empty contract");
    const requiredPrimitives = this.requiredPrimitives(document);
    return {
      healthy: true,
      version: health.version,
      digest: createHash("sha256").update(document).digest("hex"),
      document,
      requiredPrimitives
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private requiredPrimitives(document: string): Record<string, boolean> {
    let paths: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(document);
      if (this.isRecord(parsed) && this.isRecord(parsed.paths)) paths = parsed.paths;
    } catch {
      // Some OpenCode releases render /doc as HTML; textual checks remain explicit.
    }
    return Object.fromEntries(requiredPaths.map(([method, normalizedPath]) => {
      const key = `${method.toUpperCase()} ${normalizedPath}`;
      if (!paths) return [key, document.includes(normalizedPath.replaceAll("{}", ""))];
      const match = Object.entries(paths).find(
        ([path]) => path.replaceAll(/\{[^}]+\}/g, "{}") === normalizedPath
      );
      return [key, Boolean(match && this.isRecord(match[1]) && method in match[1])];
    }));
  }
}
