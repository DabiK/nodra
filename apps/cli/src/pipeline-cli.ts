import type {
  AdvancePipeline,
  CreatePipeline,
  ShowPipeline,
  ShowPipelineRun,
  ShowMission,
  StartMission,
  StartPipeline
} from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import type { I4CliHandler, I4CliRequest } from "./i4-cli.js";

export class PipelineCli implements I4CliHandler {
  constructor(
    private readonly createPipeline: CreatePipeline,
    private readonly showPipeline: ShowPipeline,
    private readonly showPipelineRun: ShowPipelineRun,
    private readonly startPipeline: StartPipeline,
    private readonly advancePipeline: AdvancePipeline,
    private readonly showMission: ShowMission,
    private readonly startMission: StartMission
  ) {}

  async execute(request: I4CliRequest): Promise<unknown | undefined> {
    if (request.command === "pipeline:create") return this.create(request);
    if (request.command === "pipeline:show") return this.show(request);
    if (request.command === "pipeline:run:show") return this.showRun(request);
    if (request.command === "pipeline:start") return this.start(request);
    if (request.command === "pipeline:advance") return this.advance(request);
    return undefined;
  }

  private create(request: I4CliRequest) {
    const values = [...request.args];
    const id = this.option(values, "--id") ?? randomUUID();
    const nodes: Array<{ nodeKey: string; missionId: ReturnType<typeof toId> }> = [];
    for (;;) {
      const node = this.option(values, "--node");
      if (!node) break;
      const separator = node.indexOf(":");
      if (separator <= 0 || separator === node.length - 1) this.usage();
      nodes.push({
        nodeKey: node.slice(0, separator),
        missionId: toId(node.slice(separator + 1))
      });
    }
    const name = values.join(" ").trim();
    if (!name) this.usage();
    return this.createPipeline.execute({
      pipelineId: toId(id),
      definitionId: toId(`${id}/definition/1`),
      nodeIdPrefix: `${id}/node`,
      edgeIdPrefix: `${id}/edge`,
      name,
      nodes,
      context: request.context
    });
  }

  private show(request: I4CliRequest) {
    if (request.args.length !== 1 || !request.args[0]) this.usage();
    return this.showPipeline.execute(toId(request.args[0]));
  }

  private showRun(request: I4CliRequest) {
    if (request.args.length !== 1 || !request.args[0]) this.usage();
    return this.showPipelineRun.execute(toId(request.args[0]));
  }

  private async start(request: I4CliRequest) {
    const runId = this.option([...request.args], "--run-id") ?? randomUUID();
    const values = [...request.args];
    this.option(values, "--run-id");
    if (values.length !== 1 || !values[0]) this.usage();
    await this.startPipeline.execute({
      pipelineId: toId(values[0]),
      pipelineRunId: toId(runId),
      nodeRunIdPrefix: `${runId}/node-run`,
      context: request.context
    });
    return this.advanceWithMissionStart(toId(runId), request);
  }

  private advance(request: I4CliRequest) {
    if (request.args.length !== 1 || !request.args[0]) this.usage();
    return this.advanceWithMissionStart(toId(request.args[0]), request);
  }

  private advanceWithMissionStart(pipelineRunId: ReturnType<typeof toId>, request: I4CliRequest) {
    return this.advancePipeline.execute({
      pipelineRunId,
      context: request.context,
      startMission: async (missionId) => {
        const commandId = toId(randomUUID());
        await this.startMission.execute({
          missionId,
          expectedVersion: await this.currentMissionVersion(missionId),
          runId: toId(randomUUID()),
          conversationId: toId(randomUUID()),
          auditId: toId(`audit/${commandId}`),
          outboxId: toId(`outbox/${commandId}`),
          context: {
            commandId,
            actor: request.context.actor,
            occurredAt: request.context.occurredAt
          }
        });
      }
    });
  }

  private async currentMissionVersion(missionId: ReturnType<typeof toId>): Promise<number> {
    const mission = await this.showMission.execute(missionId);
    if (!mission) throw new DomainError(`Mission ${missionId} was not found`, "MISSION_NOT_FOUND");
    return mission.version;
  }

  private option(values: string[], flag: string): string | undefined {
    const index = values.indexOf(flag);
    if (index < 0) return undefined;
    const value = values[index + 1];
    if (!value) this.usage();
    values.splice(index, 2);
    return value;
  }

  private usage(): never {
    throw new DomainError(
      "Usage: pipeline:create <name...> --node <key:missionId> --node <key:missionId> [--id <id>] | pipeline:show <id> | pipeline:start <id> [--run-id <id>] | pipeline:advance <runId> | pipeline:run:show <runId>",
      "CLI_USAGE_ERROR"
    );
  }
}
