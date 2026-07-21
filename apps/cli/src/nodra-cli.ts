import type {
  ChangeMissionState,
  CreateMission,
  GetHealth,
  GetRelay,
  ListMissions,
  MissionListFilter,
  ShowMission
} from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { randomUUID } from "node:crypto";

export interface CliOutput {
  write(value: string): void;
}

const usage =
  "Usage: nodra <health|mission:create [--project <id>] [--command-id <id>] <title>|mission:list [--project <id>|--scratch]|mission:show <id>|mission:<prepare|pickup|block|resume|close|abandon> <id> <expectedVersion> [reason]|relay [--project <id>|--scratch]>";

export class NodraCli {
  constructor(
    private readonly getHealth: GetHealth,
    private readonly createMission: CreateMission,
    private readonly changeMissionState: ChangeMissionState,
    private readonly listMissions: ListMissions,
    private readonly showMission: ShowMission,
    private readonly getRelay: GetRelay,
    private readonly output: CliOutput
  ) {}

  async run(arguments_: readonly string[]): Promise<number> {
    try {
      return await this.execute(arguments_);
    } catch (error) {
      if (error instanceof DomainError) {
        this.output.write(JSON.stringify({ code: error.code, detail: error.message }));
        return 1;
      }
      this.output.write(JSON.stringify({ code: "INTERNAL_ERROR", detail: "Unexpected internal error" }));
      return 1;
    }
  }

  private async execute(arguments_: readonly string[]): Promise<number> {
    const [command, ...parameters] = arguments_;
    if (command === "health") return this.write(await this.getHealth.execute());
    if (command === "mission:create") return this.create(parameters);
    if (command === "mission:list") return this.write(await this.listMissions.execute(this.readFilter(parameters)));
    if (command === "mission:show") {
      const id = parameters[0];
      if (!id || parameters.length !== 1) return this.writeUsage();
      return this.write(await this.showMission.execute(toId(id)));
    }
    if (command === "relay") return this.write(await this.getRelay.execute(this.readFilter(parameters)));
    if (command?.startsWith("mission:")) return this.transition(command.slice("mission:".length), parameters);
    return this.writeUsage();
  }

  private async create(parameters: readonly string[]): Promise<number> {
    const values = [...parameters];
    let projectId;
    let commandId;
    const projectIndex = values.indexOf("--project");
    if (projectIndex >= 0) {
      const project = values[projectIndex + 1];
      if (!project) return this.writeUsage();
      projectId = toId(project);
      values.splice(projectIndex, 2);
    }
    const commandIndex = values.indexOf("--command-id");
    if (commandIndex >= 0) {
      const command = values[commandIndex + 1];
      if (!command) return this.writeUsage();
      commandId = toId(command);
      values.splice(commandIndex, 2);
    }
    const title = values.join(" ").trim();
    if (!title) return this.writeUsage();
    return this.write(
      await this.createMission.execute({
        id: toId(randomUUID()),
        title,
        context: this.context(commandId),
        ...(projectId === undefined ? {} : { projectId })
      })
    );
  }

  private async transition(action: string, parameters: readonly string[]): Promise<number> {
    const [id, expectedVersionText, ...rest] = parameters;
    const expectedVersion = Number(expectedVersionText);
    if (!id || !Number.isInteger(expectedVersion) || expectedVersion < 0) return this.writeUsage();
    if (!["prepare", "pickup", "block", "resume", "close", "abandon"].includes(action)) return this.writeUsage();
    if (action === "block" && !rest.join(" ").trim()) return this.writeUsage();
    if (action !== "block" && rest.length > 0) return this.writeUsage();
    return this.write(
      await this.changeMissionState.execute({
        missionId: toId(id),
        expectedVersion,
        action: (action === "block" ? { type: "block", reason: rest.join(" ") } : { type: action }) as Parameters<
          ChangeMissionState["execute"]
        >[0]["action"],
        context: this.context()
      })
    );
  }

  private readFilter(parameters: readonly string[]): MissionListFilter | undefined {
    if (parameters.length === 0) return undefined;
    if (parameters.length === 1 && parameters[0] === "--scratch") return { projectId: null };
    if (parameters.length === 2 && parameters[0] === "--project" && parameters[1]) {
      return { projectId: toId(parameters[1]) };
    }
    throw new DomainError(usage, "CLI_USAGE_ERROR");
  }

  private context(commandId?: ReturnType<typeof toId>) {
    return { commandId: commandId ?? toId(randomUUID()), actor: "user" as const, occurredAt: new Date().toISOString() };
  }

  private write(value: unknown): number {
    this.output.write(JSON.stringify(value, null, 2));
    return 0;
  }

  private writeUsage(): number {
    this.output.write(usage);
    return 2;
  }
}
