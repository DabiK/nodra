import type { CreateMission, GetHealth } from "@nodra/application";
import { asId } from "@nodra/domain";
import { randomUUID } from "node:crypto";

export interface CliOutput {
  write(value: string): void;
}

export class NodraCli {
  constructor(
    private readonly getHealth: GetHealth,
    private readonly createMission: CreateMission,
    private readonly output: CliOutput
  ) {}

  async run(arguments_: readonly string[]): Promise<number> {
    const [command, ...parameters] = arguments_;
    if (command === "health") {
      this.output.write(JSON.stringify(await this.getHealth.execute(), null, 2));
      return 0;
    }
    if (command === "mission:create") {
      const title = parameters.join(" ").trim();
      if (!title) {
        this.output.write("Usage: nodra mission:create <title>");
        return 2;
      }
      const mission = await this.createMission.execute({
        id: asId(randomUUID()),
        title,
        executionKind: "human",
        now: new Date().toISOString()
      });
      this.output.write(JSON.stringify(mission, null, 2));
      return 0;
    }
    this.output.write("Usage: nodra <health|mission:create <title>>");
    return 2;
  }
}
