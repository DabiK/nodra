import { DomainError, toId, type CommandContext } from "@nodra/application";
import { randomUUID } from "node:crypto";

export interface I4CliRequest { command: string; args: readonly string[]; context: CommandContext; }
export interface I4CliHandler { execute(request: I4CliRequest): Promise<unknown | undefined>; }

export class I4Cli {
  constructor(private readonly handlers: readonly I4CliHandler[]) {}
  async execute(command: string, input: readonly string[]): Promise<unknown | undefined> {
    const parsed = this.commandId(input);
    const request = { command, args: parsed.args, context: { commandId: parsed.id ?? toId(randomUUID()), actor: "user" as const, occurredAt: new Date().toISOString() } };
    for (const handler of this.handlers) { const result = await handler.execute(request); if (result !== undefined) return result; }
    return undefined;
  }
  private commandId(args: readonly string[]): { args: readonly string[]; id?: ReturnType<typeof toId> } {
    const separator = args.indexOf("--"); const index = args.findIndex((value, position) => value === "--command-id" && (separator < 0 || position < separator));
    if (index < 0) return { args }; const value = args[index + 1]; if (!value) throw new DomainError("--command-id requires a value", "CLI_USAGE_ERROR");
    return { args: [...args.slice(0, index), ...args.slice(index + 2)], id: toId(value) };
  }
}
