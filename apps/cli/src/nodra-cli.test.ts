import { CreateMission, GetHealth } from "@nodra/application";
import type { MissionRepository } from "@nodra/application";
import type { HealthProbe } from "@nodra/application";
import type { Mission, Id } from "@nodra/domain";
import { describe, expect, it } from "vitest";
import { NodraCli, type CliOutput } from "./nodra-cli.js";

class MemoryMissionRepository implements MissionRepository {
  readonly saved: Mission[] = [];

  async load(_id: Id): Promise<Mission | null> {
    return null;
  }

  async save(mission: Mission): Promise<void> {
    this.saved.push(mission);
  }
}

class HealthyProbe implements HealthProbe {
  async check() {
    return { status: "ok" as const };
  }
}

class MemoryOutput implements CliOutput {
  readonly values: string[] = [];

  write(value: string): void {
    this.values.push(value);
  }
}

describe("NodraCli", () => {
  it("runs the shared health use case", async () => {
    const output = new MemoryOutput();
    const cli = new NodraCli(new GetHealth(new HealthyProbe()), new CreateMission(new MemoryMissionRepository()), output);

    expect(await cli.run(["health"])).toBe(0);
    expect(JSON.parse(output.values[0] ?? "{}")).toMatchObject({ service: "nodra", status: "ok" });
  });

  it("creates a mission through the application use case", async () => {
    const missions = new MemoryMissionRepository();
    const output = new MemoryOutput();
    const cli = new NodraCli(new GetHealth(new HealthyProbe()), new CreateMission(missions), output);

    expect(await cli.run(["mission:create", "Préparer", "I2"])).toBe(0);
    expect(missions.saved[0]?.snapshot()).toMatchObject({ title: "Préparer I2", state: "DRAFT" });
  });
});
