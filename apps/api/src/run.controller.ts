import { Body, Controller, HttpCode, Inject, Param, Post } from "@nestjs/common";
import { and, eq, max } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { NodraSqliteDatabase } from "@nodra/adapters";
import { conversationItems, conversations, managers, runConfigSnapshots, runs, workspaces } from "@nodra/adapters";
import type { CancelRun, ChangeMissionState, ResumeRun, ShowMission, SteerRun } from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { commandContext } from "./command-context.js";
import { CANCEL_RUN, CHANGE_MISSION_STATE, DATABASE, RESUME_RUN, SHOW_MISSION, STEER_RUN } from "./tokens.js";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { SteerRunDto } from "./dto/steer-run.dto.js";

const TERMINAL_RUN_STATES = ["SUCCEEDED", "FAILED", "CANCELLED"];

@Controller("api/runs")
export class RunController {
  constructor(
    @Inject(CANCEL_RUN) private readonly cancelRun: CancelRun,
    @Inject(RESUME_RUN) private readonly resumeRun: ResumeRun,
    @Inject(STEER_RUN) private readonly steerRun: SteerRun,
    @Inject(DATABASE) private readonly database: NodraSqliteDatabase,
    @Inject(SHOW_MISSION) private readonly showMission: ShowMission,
    @Inject(CHANGE_MISSION_STATE) private readonly changeMissionState: ChangeMissionState
  ) {}

  @Post(":id/cancel")
  @HttpCode(202)
  cancel(@Param("id") id: string) {
    return this.cancelRun.execute(toId(id));
  }

  @Post(":id/resume")
  @HttpCode(202)
  resume(@Param("id") id: string) {
    return this.resumeRun.execute(toId(id));
  }

  @Post(":id/steer")
  @HttpCode(202)
  async steer(@Param("id") id: string, @Body() body: SteerRunDto) {
    const result = await this.steerRun.execute(toId(id), body.text);
    const run = this.database.orm.select({ conversationId: runs.conversationId })
      .from(runs).where(eq(runs.id, id)).get();
    if (!run) throw new DomainError(`Run ${id} was not found`, "RUN_NOT_FOUND");
    const now = new Date().toISOString();
    this.database.orm.transaction((transaction: NodraSqliteDatabase["orm"]) => {
      const ordinal = (transaction.select({ value: max(conversationItems.ordinal) })
        .from(conversationItems).where(eq(conversationItems.conversationId, run.conversationId)).get()?.value ?? -1) + 1;
      transaction.insert(conversationItems).values({
        id: `conversation-item/${id}/steer/${randomUUID()}`,
        conversationId: run.conversationId,
        ordinal,
        kind: "steer",
        deliveryState: "sent",
        body: body.text.trim(),
        providerItemRef: null,
        createdAt: now,
        acknowledgedAt: null
      }).run();
    });
    return result;
  }

  // Hard kill for a runaway agent. Best-effort cancels the workflow and the
  // provider session, then forces the run terminal and unblocks the mission so
  // the operator regains control even when the workflow is already lost.
  @Post(":id/force-stop")
  @HttpCode(202)
  async forceStop(@Param("id") id: string) {
    const run = this.database.orm.select({
      run: runs,
      workspaceId: runConfigSnapshots.workspaceId
    }).from(runs).innerJoin(runConfigSnapshots, eq(runConfigSnapshots.runId, runs.id))
      .where(eq(runs.id, id)).get();
    if (!run) throw new DomainError(`Run ${id} was not found`, "RUN_NOT_FOUND");

    // 1. Best-effort: signal the Temporal workflow to cancel.
    await this.cancelRun.execute(toId(id)).catch(() => undefined);

    // 2. Best-effort: abort the provider session directly (kills OpenCode agent).
    const conversation = this.database.orm.select().from(conversations).where(eq(conversations.id, run.run.conversationId)).get();
    await this.abortProviderSession(run.run.providerId, conversation?.providerSessionRef ?? null);

    // 3. Force the run into a terminal state so the UI stops "thinking".
    const now = new Date().toISOString();
    if (!TERMINAL_RUN_STATES.includes(run.run.state)) {
      this.database.orm.update(runs).set({ state: "CANCELLED", endedAt: now }).where(eq(runs.id, id)).run();
      if (conversation && conversation.state !== "closed" && conversation.state !== "deleted") {
        this.database.orm.update(conversations).set({ state: "idle" }).where(eq(conversations.id, conversation.id)).run();
      }
    }
    if (run.workspaceId) {
      this.database.orm.update(workspaces).set({ state: "ready" })
        .where(and(eq(workspaces.id, run.workspaceId), eq(workspaces.state, "in_use"))).run();
    }

    // 4. Unblock the subject. An ACTIVE agent mission moves to BLOCKED; an
    //    ACTIVE manager returns to ready so the operator can chat again.
    let missionState: string | null = null;
    if (run.run.missionId) {
      const mission = await this.showMission.execute(toId(run.run.missionId));
      missionState = mission?.state ?? null;
      if (mission && mission.state === "ACTIVE") {
        const changed = await this.changeMissionState.execute({
          missionId: toId(run.run.missionId),
          expectedVersion: mission.version,
          action: { type: "block", reason: "provider" },
          context: commandContext()
        }).catch(() => null);
        missionState = changed?.state ?? missionState;
      }
    }
    if (run.run.managerId) {
      this.database.orm.update(managers).set({ state: "ready" })
        .where(and(eq(managers.id, run.run.managerId), eq(managers.state, "active"))).run();
    }

    return { runId: id, state: "force_stopped", runState: "CANCELLED", missionState };
  }

  private async abortProviderSession(providerId: string, sessionRef: string | null): Promise<void> {
    if (!sessionRef) return;
    if (providerId !== "opencode") return;
    const baseUrl = process.env.NODRA_OPENCODE_URL;
    if (!baseUrl) return;
    try {
      await fetch(`${baseUrl.replace(/\/$/, "")}/session/${encodeURIComponent(sessionRef)}/abort`, {
        method: "POST",
        headers: { "content-type": "application/json" }
      });
    } catch {
      // Provider may already be down; the forced DB state below still applies.
    }
  }
}
