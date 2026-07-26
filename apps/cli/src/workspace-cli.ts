import type {
  CommitWorkspace,
  CreateWorkspace,
  DeleteWorkspace,
  IntegrateWorkspace,
  ReadWorkspace,
  RestoreWorkspace,
  SnapshotWorkspace
} from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import type { I4CliHandler, I4CliRequest } from "./i4-cli.js";

export class WorkspaceCli implements I4CliHandler {
  constructor(
    private readonly createWorkspace: CreateWorkspace,
    private readonly readWorkspace: ReadWorkspace,
    private readonly snapshotWorkspace: SnapshotWorkspace,
    private readonly commitWorkspace: CommitWorkspace,
    private readonly integrateWorkspace: IntegrateWorkspace,
    private readonly deleteWorkspace: DeleteWorkspace,
    private readonly restoreWorkspace: RestoreWorkspace
  ) {}

  async execute(request: I4CliRequest): Promise<unknown | undefined> {
    if (request.command === "workspace:create") return this.create(request);
    if (request.command === "workspace:show") {
      if (request.args.length !== 1 || !request.args[0]) this.usage();
      return this.readWorkspace.execute(toId(request.args[0] as string));
    }
    if (request.command === "workspace:snapshot") {
      const [workspaceId, ...reason] = request.args;
      if (!workspaceId || !reason.join(" ").trim()) this.usage();
      return this.snapshotWorkspace.execute({
        workspaceId: toId(workspaceId),
        snapshotId: toId(`${request.context.commandId}/snapshot`),
        reason: reason.join(" "),
        context: request.context
      });
    }
    if (request.command === "workspace:commit") return this.commit(request);
    if (request.command === "workspace:integrate") return this.integrate(request);
    if (request.command === "workspace:delete") return this.delete(request);
    if (request.command === "workspace:restore") {
      if (request.args.length !== 1 || !request.args[0]) this.usage();
      return this.restoreWorkspace.execute({
        workspaceId: toId(request.args[0] as string),
        context: request.context
      });
    }
    return undefined;
  }

  private create(request: I4CliRequest) {
    const values = [...request.args];
    const sourceWorkspaceId = this.option(values, "--source");
    const baseRef = this.option(values, "--base");
    const branchName = this.option(values, "--branch");
    const integrationTargetRef = this.option(values, "--integration-target");
    const id = this.option(values, "--id");
    const [kind, path] = values;
    if (!kind || !path || values.length !== 2 || !["repo", "scratch", "worktree"].includes(kind)) {
      this.usage();
    }
    return this.createWorkspace.execute({
      id: toId(id ?? randomUUID()),
      kind: kind as "repo" | "scratch" | "worktree",
      path,
      ...(sourceWorkspaceId ? { sourceWorkspaceId: toId(sourceWorkspaceId) } : {}),
      ...(baseRef ? { baseRef } : {}),
      ...(branchName ? { branchName } : {}),
      ...(integrationTargetRef ? { integrationTargetRef } : {}),
      context: request.context
    });
  }

  private commit(request: I4CliRequest) {
    const values = [...request.args];
    const confirmationId = this.option(values, "--confirmation");
    const [workspaceId, missionId, ...message] = values;
    if (!workspaceId || !missionId || !message.join(" ").trim()) this.usage();
    return this.commitWorkspace.execute({
      workspaceId: toId(workspaceId),
      missionId: toId(missionId),
      message: message.join(" "),
      ...(confirmationId ? { confirmationId: toId(confirmationId) } : {}),
      context: request.context
    });
  }

  private integrate(request: I4CliRequest) {
    const values = [...request.args];
    const confirmationId = this.option(values, "--confirmation");
    const [workspaceId, method, sourceRef, targetRef] = values;
    if (
      !workspaceId || !sourceRef || !targetRef || !confirmationId || values.length !== 4 ||
      !["merge", "rebase", "cherry-pick"].includes(method ?? "")
    ) this.usage();
    return this.integrateWorkspace.execute({
      workspaceId: toId(workspaceId as string),
      method: method as "merge" | "rebase" | "cherry-pick",
      sourceRef: sourceRef as string,
      targetRef: targetRef as string,
      confirmationId: toId(confirmationId as string),
      context: request.context
    });
  }

  private delete(request: I4CliRequest) {
    const values = [...request.args];
    const confirmationId = this.option(values, "--confirmation");
    const [workspaceId] = values;
    if (!workspaceId || values.length !== 1) this.usage();
    return this.deleteWorkspace.execute({
      workspaceId: toId(workspaceId as string),
      ...(confirmationId ? { confirmationId: toId(confirmationId) } : {}),
      context: request.context
    });
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
    throw new DomainError("Invalid workspace command", "CLI_USAGE_ERROR");
  }
}
