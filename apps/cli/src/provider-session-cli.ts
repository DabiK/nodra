import type { AttachExternalProviderSession } from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import type { I4CliHandler, I4CliRequest } from "./i4-cli.js";

const usage = "Usage: nodra provider-session:attach --provider <provider-id> --session <external-session-id> --mission <mission-id> [--command-id <stable-id>]";

export class ProviderSessionCli implements I4CliHandler {
  constructor(private readonly attach: AttachExternalProviderSession) {}

  async execute(request: I4CliRequest): Promise<unknown | undefined> {
    if (request.command !== "provider-session:attach") return undefined;
    const values = [...request.args];
    const providerId = this.option(values, "--provider");
    const externalSessionId = this.option(values, "--session");
    const missionId = this.option(values, "--mission");
    if (!providerId || !externalSessionId || !missionId || values.length !== 0) {
      throw new DomainError(usage, "CLI_USAGE_ERROR");
    }
    return this.attach.execute({
      providerId,
      externalSessionId,
      missionId: toId(missionId),
      commandId: request.context.commandId,
      actor: request.context.actor,
      occurredAt: request.context.occurredAt
    });
  }

  private option(values: string[], flag: string): string | undefined {
    const index = values.indexOf(flag);
    if (index < 0) return undefined;
    const value = values[index + 1];
    if (!value || values.indexOf(flag, index + 1) >= 0) throw new DomainError(usage, "CLI_USAGE_ERROR");
    values.splice(index, 2);
    return value;
  }
}
