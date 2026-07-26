import type { Id } from "@nodra/domain";
import type { ResolveAgentConfig } from "./resolve-agent-config.js";

export class PreviewAgentConfig {
  constructor(private readonly resolver: ResolveAgentConfig) {}

  execute(missionId: Id) {
    return this.resolver.preview(missionId);
  }
}
