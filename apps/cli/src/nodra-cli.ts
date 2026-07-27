import type {
  ChangeMissionState,
  CreateMission,
  DispatchWorkflowOutbox,
  GetHealth,
  GetRelay,
  ListMissions,
  MissionListFilter,
  ReconcileWorkflows,
  StartMission,
  ShowMission
} from "@nodra/application";
import { ConfirmationRequiredError, DomainError, toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import type { I4Cli } from "./i4-cli.js";
import type { I6Cli } from "./i6-cli.js";
import type { AgentConfigCli } from "./agent-config-cli.js";

export interface CliOutput {
  write(value: string): void;
}

export const CLI_USAGE = "Usage: nodra <command> [arguments]";

export const CLI_HELP = `
Nodra CLI

Usage:
  nodra <command> [arguments]

General:
  help
  -h
  --help
      Show this help.

  health
      Check SQLite, Temporal and provider health.

Missions:
  mission:create <title...>
    [--project <project-id>]
    [--command-id <command-id>]
      Create a mission.

  mission:list
  mission:list --scratch
  mission:list --project <project-id>
      List missions, optionally filtered by project.

  mission:show <mission-id>
      Show a mission.

  mission:start <mission-id> <expected-version>
    [--command-id <command-id>]
      Start a mission and create its workflow run.

  mission:prepare <mission-id> <expected-version>
      Move a mission to the prepared state.

  mission:pickup <mission-id> <expected-version>
      Pick up a mission.

  mission:block <mission-id> <expected-version> <reason...>
      Block a mission with a reason.

  mission:resume <mission-id> <expected-version>
      Resume a blocked mission.

  mission:close <mission-id> <expected-version>
      Close a mission.

  mission:abandon <mission-id> <expected-version>
      Abandon a mission.

Mission agent configuration:
  mission:agent-enable <mission-id> <mission-version>
      Enable the configured agent for a mission.

  mission:agent-show <mission-id>
      Show the stored agent configuration.

  mission:agent-preview <mission-id>
      Preview the resolved agent configuration.

  mission:agent-config <mission-id> <config-version>
    --provider <provider-id>
    --model <model-id>
    --effort <minimal|low|medium|high|xhigh|provider_default>
    --prompt <text>
    --permission <read_only|workspace|full_access>
    --workspace <workspace-id>
    [--auto-commit]
    [--integration-ref <git-ref>]
    [--options-version <version>]
    [--options-json <json-object>]
      Configure the agent used by a mission.

Relay:
  relay
  relay --scratch
  relay --project <project-id>
      Show the mission relay, optionally filtered by project.

Pipelines:
  pipeline:create <name...>
    --node <key:mission-id>
    --node <key:mission-id>
    [--edge <from-key:to-key>]
    [--id <pipeline-id>]
      Create a published pipeline from existing missions. Without edges,
      nodes are linked linearly in declaration order.

  pipeline:show <pipeline-id>
      Show a pipeline definition.

  pipeline:start <pipeline-id>
    [--run-id <pipeline-run-id>]
      Start a pipeline run and start ready mission nodes.

  pipeline:advance <pipeline-run-id>
      Reconcile node states and start newly ready mission nodes.

  pipeline:mode <pipeline-run-id> <node-key> <auto|human>
      Change transition mode for a node in a started pipeline.

  pipeline:approve-transition <pipeline-run-id> <node-key>
      Approve a human-gated transition and make the node eligible to start.

  pipeline:publish-handover <pipeline-run-id> <node-key>
      Snapshot the node mission's latest assistant message as handover.

  pipeline:run:show <pipeline-run-id>
      Show a pipeline run and node states.

Temporal:
  temporal:dispatch
      Dispatch up to 100 pending workflow outbox entries.

  temporal:reconcile
      Reconcile persisted workflow state with Temporal.

Evidence:
  evidence:list <run-id>
      List evidence collected for a run.

  evidence:show <evidence-id>
      Show one evidence record.

  evidence:collect-git <run-id>
      Collect the current Git observation for a run.

  evidence:collect-command <run-id>
    --cwd <directory>
    [--timeout <milliseconds>]
    [--max-output <bytes>]
    -- <command> [arguments...]
      Execute a command and store its output as evidence.

      Defaults:
        --timeout     30000
        --max-output  1000000

Gates:
  gate:define <mission-id> <name>
    [--expected-exit <exit-code>]
    [--requires-git]
      Define and bind a command-exit gate to a mission.

  gate:evaluate <binding-id> <run-id> <evidence-id...>
      Evaluate a gate using one or more evidence records.

  gate:list <mission-id>
      List gates bound to a mission.

  gate:refresh-staleness <run-id>
      Refresh gate staleness for a run.

  gate:override <evaluation-id> <approval-id>
    <accept|reject|waive>
    <comment...>
      Override a gate evaluation using an approval.

  gate:bind-pipeline
      Unavailable until pipeline gate bindings are implemented.

Approvals:
  approval:show <approval-id>
      Show an approval request.

  approval:request <run|mission|manager> <subject-id> <kind...>
      Create an approval request for a run, mission or manager.

  approval:decide <approval-id>
    <approved|denied>
    <actor>
    <comment...>
      Approve or deny an approval request.

Deliveries:
  delivery:show <delivery-id>
      Show a delivery.

  delivery:declare <run-id>
    <expected-mission-version>
    <agent-declaration>
    <observation-summary...>
      Declare the delivery produced by a run.

  delivery:accept <run-id>
    <expected-mission-version>
    <comment...>
      Accept a delivery.

  delivery:request-changes <run-id>
    <expected-mission-version>
    <comment...>
      Request changes to a delivery.

  delivery:reject <run-id>
    <expected-mission-version>
    <comment...>
      Reject a delivery.

Confirmations:
  confirmation:show <confirmation-id>
      Show a confirmation request.

  confirmation:request
    [--cwd <directory>]
    <action>
    <risk>
    <once|run|mission>
    <run|mission|workspace>
    <subject-id>
    <expires-at>
    <target-json>
      Request confirmation for a potentially sensitive action.

      target-json must be a valid JSON object.

  confirmation:decide <confirmation-id>
    <approved|denied>
    <actor>
    <comment...>
      Approve or deny a confirmation request.

Additional command groups:
  provider:*
      Provider status, probing and smoke-test commands.

  run:*
      Run cancellation, resumption and steering commands.

  workspace:*
      Workspace creation, inspection, snapshots, commits,
      integration, deletion and restoration commands.

Examples:
  nodra health

  nodra mission:create "Implement provider fallback"

  nodra mission:create "Fix authentication"
    --project project-123

  nodra mission:list --scratch

  nodra mission:start mission-123 2

  nodra mission:block mission-123 3 "Waiting for API credentials"

  nodra mission:agent-config mission-123 0
    --provider opencode
    --model qwen3-coder
    --effort high
    --prompt "Implement the mission and run the tests"
    --permission workspace
    --workspace workspace-123
    --auto-commit

  nodra evidence:collect-command run-123
    --cwd /path/to/repository
    --timeout 60000
    -- npm test

  nodra gate:define mission-123 "Unit tests"
    --expected-exit 0
    --requires-git

  nodra approval:request run run-123 production-deployment

  nodra confirmation:request
    --cwd /path/to/repository
    execute-command
    high
    run
    run
    run-123
    2026-07-26T18:00:00Z
    '{"command":"npm deploy"}'
`.trim();

const HELP_COMMANDS = new Set([
  "help",
  "-h",
  "--help"
]);

export const isCliHelpRequest = (
  arguments_: readonly string[]
): boolean => {
  const [command] = arguments_;

  return command === undefined || HELP_COMMANDS.has(command);
};


export class NodraCli {
  constructor(
    private readonly getHealth: GetHealth,
    private readonly createMission: CreateMission,
    private readonly changeMissionState: ChangeMissionState,
    private readonly listMissions: ListMissions,
    private readonly showMission: ShowMission,
    private readonly getRelay: GetRelay,
    private readonly startMission: StartMission,
    private readonly dispatchWorkflowOutbox: DispatchWorkflowOutbox,
    private readonly reconcileWorkflows: ReconcileWorkflows,
    private readonly output: CliOutput,
    private readonly i4?: I4Cli,
    private readonly i6?: I6Cli,
    private readonly agentConfig?: AgentConfigCli
  ) {}

  async run(arguments_: readonly string[]): Promise<number> {
    try {
      return await this.execute(arguments_);
    } catch (error) {
      if (error instanceof DomainError) {
        this.output.write(JSON.stringify({
          code: error.code,
          detail: error.message,
          ...(error instanceof ConfirmationRequiredError
            ? { confirmation: error.confirmation }
            : {})
        }));
        return 1;
      }
      this.output.write(JSON.stringify({ code: "INTERNAL_ERROR", detail: "Unexpected internal error" }));
      return 1;
    }
  }

  private async execute(arguments_: readonly string[]): Promise<number> {
    if (isCliHelpRequest(arguments_)) {
      return this.writeHelp();
    }

    const [command, ...parameters] = arguments_;
    if (command === "health") return this.write(await this.getHealth.execute());
    if (command === "mission:create") return this.create(parameters);
    if (command === "mission:list") return this.write(await this.listMissions.execute(this.readFilter(parameters)));
    if (command === "mission:show") {
      const id = parameters[0];
      if (!id || parameters.length !== 1) return this.writeUsage();
      return this.write(await this.showMission.execute(toId(id)));
    }
    if (command === "mission:start") return this.start(parameters);
    if (command === "relay") return this.write(await this.getRelay.execute(this.readFilter(parameters)));
    if (command === "temporal:dispatch" && parameters.length === 0) {
      return this.write(await this.dispatchWorkflowOutbox.execute({ limit: 100, occurredAt: new Date().toISOString() }));
    }
    if (command === "temporal:reconcile" && parameters.length === 0) {
      return this.write(await this.reconcileWorkflows.execute());
    }
    if (command && this.i4) {
      const result = await this.i4.execute(command, parameters);
      if (result !== undefined) return this.write(result);
    }
    if (command && this.i6) {
      const result = await this.i6.execute(command, parameters);
      if (result !== undefined) return this.write(result);
    }
    if (command && this.agentConfig) {
      const result = await this.agentConfig.execute(command, parameters);
      if (result !== undefined) return this.write(result);
    }
    if (command?.startsWith("mission:")) return this.transition(command.slice("mission:".length), parameters);
    return this.writeUsage(`Unknown command: ${command}`);
  }

  private async start(parameters: readonly string[]): Promise<number> {
    const values = [...parameters];
    let commandId;
    const commandIndex = values.indexOf("--command-id");
    if (commandIndex >= 0) {
      const command = values[commandIndex + 1];
      if (!command) return this.writeUsage();
      commandId = toId(command);
      values.splice(commandIndex, 2);
    }
    const [missionId, expectedVersionText] = values;
    const expectedVersion = Number(expectedVersionText);
    if (!missionId || values.length !== 2 || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return this.writeUsage();
    }
    const context = this.context(commandId);
    return this.write(await this.startMission.execute({
      missionId: toId(missionId),
      expectedVersion,
      runId: toId(randomUUID()),
      conversationId: toId(randomUUID()),
      auditId: toId(`audit/${context.commandId}`),
      outboxId: toId(`outbox/${context.commandId}`),
      context
    }));
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
    throw new DomainError(CLI_USAGE, "CLI_USAGE_ERROR");
  }

  private context(commandId?: ReturnType<typeof toId>) {
    return { commandId: commandId ?? toId(randomUUID()), actor: "user" as const, occurredAt: new Date().toISOString() };
  }

  private write(value: unknown): number {
    this.output.write(JSON.stringify(value, null, 2));
    return 0;
  }


  private writeHelp(): number {
    this.output.write(CLI_HELP);
    return 0;
  }

  private writeUsage(detail?: string): number {
    this.output.write(
      detail
        ? `${detail}\n\n${CLI_HELP}`
        : CLI_HELP
    );

    return 2;
  }
}
