import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { CollectEvidence, ManageApprovals, ManageDelivery, ManageGates, StructuredGateEvaluatorRegistry } from "@nodra/application";
import { asId } from "@nodra/domain";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContentAddressedBlobStore } from "../fs/content-addressed-blob-store.js";
import { ReadOnlyGitObservationAdapter } from "../git/read-only-git-observation-adapter.js";
import { LocalCommandObservationAdapter } from "../process/local-command-observation-adapter.js";
import { migrateDatabase } from "./migrate-database.js";
import { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { SqliteApprovalRepository } from "./sqlite-approval-repository.js";
import { SqliteDeliveryRepository } from "./sqlite-delivery-repository.js";
import { SqliteEvidenceRepository } from "./sqlite-evidence-repository.js";
import { SqliteGateRepository } from "./sqlite-gate-repository.js";
import { approvals, gateOverrides } from "./schema/approvals.js";
import { conversations } from "./schema/conversations.js";
import { workspaces } from "./schema/core.js";
import { gateEvaluations } from "./schema/gates.js";
import { missions } from "./schema/missions.js";
import { businessAuditEvents, relayItems } from "./schema/operations.js";
import { runConfigSnapshots, runs } from "./schema/runs.js";

const exec = promisify(execFile); const at = (minute: number) => `2026-07-22T10:${String(minute).padStart(2, "0")}:00.000Z`;
const context = (id: string, minute: number) => ({ commandId: asId(id), actor: "user" as const, occurredAt: at(minute) });

describe("I4 evidence, gates, approvals and delivery", () => {
  let database: NodraSqliteDatabase; let root: string; let workspace: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "nodra-i4-")); workspace = join(root, "workspace"); await exec("git", ["init", workspace]); await writeFile(join(workspace, "tracked.txt"), "initial\n"); await exec("git", ["-C", workspace, "add", "tracked.txt"]); await exec("git", ["-C", workspace, "-c", "user.name=Nodra", "-c", "user.email=nodra@local", "commit", "-m", "seed"]);
    database = NodraSqliteDatabase.open(join(root, "nodra.db")); await migrateDatabase(database, resolve("packages/adapters/drizzle"));
    database.orm.insert(workspaces).values({ id: "workspace", projectId: null, kind: "repo", path: workspace, state: "in_use", createdAt: at(0) }).run();
    database.orm.insert(missions).values({ id: "mission", projectId: null, title: "I4", executionKind: "agent", state: "ACTIVE", version: 2, createdAt: at(0), updatedAt: at(0) }).run();
    database.orm.insert(conversations).values({ id: "conversation", missionId: "mission", managerId: null, providerId: "none", state: "open", createdAt: at(0) }).run();
    database.orm.insert(runs).values({ id: "run", missionId: "mission", managerId: null, conversationId: "conversation", userAttempt: 1, state: "STARTING", temporalWorkflowId: "run/run", providerId: "none", modelId: "none", createdAt: at(0) }).run();
    database.orm.insert(runConfigSnapshots).values({ runId: "run", resolutionSchemaVersion: 1, providerIdRequested: "none", providerIdResolved: "none", modelIdRequested: "none", modelIdResolved: "none", providerOptionsSchemaVersion: 1, providerOptionsJson: "{}", providerCapabilitiesJson: "{}", promptKind: "mission", promptCompositionSchemaVersion: 1, promptEffective: "", permissionPreset: "read_only", budgetSnapshotJson: "{}", workspaceId: "workspace", cwd: workspace, createdAt: at(0) }).run();
  });
  afterEach(() => database.close());

  it("runs failed -> structured passed -> stale -> approved override -> human accepted atomically", async () => {
    const evidenceRepository = new SqliteEvidenceRepository(database); const blobStore = new ContentAddressedBlobStore(root); const git = new ReadOnlyGitObservationAdapter();
    const collect = new CollectEvidence(evidenceRepository, blobStore, new LocalCommandObservationAdapter(git), git); const gates = new ManageGates(new SqliteGateRepository(database), evidenceRepository, blobStore, new StructuredGateEvaluatorRegistry(), git); const approval = new ManageApprovals(new SqliteApprovalRepository(database)); const delivery = new ManageDelivery(new SqliteDeliveryRepository(database));
    await gates.define({ definition: { id: asId("gate"), name: "command succeeds", evaluatorId: "command-exit", evaluatorVersion: "1", criteriaSchemaVersion: 1, criteria: { schemaVersion: 1, expectedExitCode: 0, requiresGit: true }, expectedEvidence: { schemaVersion: 1, kind: "observation", collectorId: "nodra.command", collectorVersion: "1" }, createdAt: at(1) }, missionBindingId: asId("binding"), missionId: asId("mission"), context: context("define", 1) });
    await evidenceRepository.save({ id: asId("declaration"), runId: asId("run"), kind: "declaration", subjectDigest: "d".repeat(64), collectorId: "agent", collectorVersion: "1", payload: { schemaVersion: 1, runId: "run", missionId: "mission", attempt: 1, text: "tests passed" }, createdAt: at(2), blobs: [] }, context("declaration", 2));
    const failed = await gates.evaluate({ evaluationId: asId("evaluation-failed"), bindingId: asId("binding"), runId: asId("run"), evidenceIds: [asId("declaration")], context: context("evaluate-failed", 3) }); expect(failed).toMatchObject({ state: "failed", rationale: "EXPECTED_OBSERVATION_MISSING" });
    const corrupt = await collect.command({ evidenceId: asId("corrupt-observation"), runId: asId("run"), argv: [process.execPath, "-e", "process.stdout.write('corrupt-me')"], cwd: workspace, timeoutMs: 5_000, maxOutputBytes: 1_000, context: context("collect-corrupt", 3) }); await writeFile(join(root, corrupt.blobs[0]!.blob.relativePath), "tampered");
    const corruptEvaluation = await gates.evaluate({ evaluationId: asId("evaluation-corrupt"), bindingId: asId("binding"), runId: asId("run"), evidenceIds: [asId("corrupt-observation")], context: context("evaluate-corrupt", 3) }); expect(corruptEvaluation).toMatchObject({ state: "failed", rationale: "BLOB_MISSING_OR_CORRUPT" });
    const observation = await collect.command({ evidenceId: asId("observation"), runId: asId("run"), argv: [process.execPath, "-e", "process.stdout.write('ok')"], cwd: workspace, timeoutMs: 5_000, maxOutputBytes: 1_000, context: context("collect", 4) });
    expect(observation.payload).toMatchObject({ schemaVersion: 1, missionId: "mission", attempt: 1, exitCode: 0, timedOut: false, environment: { PATH: "[REDACTED]", LANG: "[REDACTED]" } }); expect(observation.blobs).toHaveLength(2);
    const passed = await gates.evaluate({ evaluationId: asId("evaluation-passed"), bindingId: asId("binding"), runId: asId("run"), evidenceIds: [asId("observation")], context: context("evaluate-passed", 5) }); expect(passed.rationale).toBe("STRUCTURED_CRITERIA_SATISFIED"); expect(passed.state).toBe("passed");
    await writeFile(join(workspace, "tracked.txt"), "changed after proof\n"); const refreshed = await gates.refreshStaleness({ runId: asId("run"), context: context("stale", 6) }); expect(refreshed.stale).toEqual(["evaluation-passed"]); expect(database.orm.select().from(gateEvaluations).where(eq(gateEvaluations.id, "evaluation-passed")).get()).toMatchObject({ state: "stale", staleAt: at(6) });
    await delivery.declare({ id: asId("delivery"), runId: asId("run"), agentDeclaration: "implementation delivered", observationSummary: "command observation attached", expectedMissionVersion: 2, context: context("declare-delivery", 7) });
    await expect(delivery.decide({ runId: asId("run"), decision: "accept", comment: "premature", expectedMissionVersion: 3, context: context("blocked-accept", 8) })).rejects.toMatchObject({ code: "EVIDENCE_STALE" }); expect(database.orm.select().from(missions).where(eq(missions.id, "mission")).get()).toMatchObject({ state: "VALIDATION", version: 3 });
    await approval.request({ id: asId("approval"), subject: { runId: asId("run") }, kind: "stale-gate-override", context: context("approval-request", 9) }); await expect(gates.override({ overrideId: asId("premature-override"), evaluationId: asId("evaluation-passed"), approvalId: asId("approval"), decision: "accept", comment: "too early", context: context("premature-override", 9) })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" }); await approval.decide({ id: asId("approval"), decision: "approved", actor: "human", comment: "reviewed diff", context: context("approval-decide", 10) });
    await gates.override({ overrideId: asId("override"), evaluationId: asId("evaluation-passed"), approvalId: asId("approval"), decision: "accept", comment: "accept after human review", context: context("override", 11) });
    expect(database.orm.select().from(gateEvaluations).where(eq(gateEvaluations.id, "evaluation-passed")).get()?.state).toBe("stale"); expect(database.orm.select().from(gateOverrides).all()).toHaveLength(1);
    const accepted = await delivery.decide({ runId: asId("run"), decision: "accept", comment: "accepted by human", expectedMissionVersion: 3, context: context("accept", 12) }); expect(accepted.resultState).toBe("accepted"); expect(database.orm.select().from(missions).where(eq(missions.id, "mission")).get()).toMatchObject({ state: "DONE", version: 4 }); expect(database.orm.select().from(relayItems).where(eq(relayItems.missionId, "mission")).get()).toMatchObject({ state: "resolved" });
    expect(database.orm.select().from(businessAuditEvents).where(eq(businessAuditEvents.commandId, "blocked-accept")).all()).toHaveLength(0);
  });

  it("keeps evidence immutable and approvals one-shot", async () => {
    const repository = new SqliteEvidenceRepository(database); const record = { id: asId("immutable"), runId: asId("run"), kind: "declaration" as const, subjectDigest: "a".repeat(64), collectorId: "agent", collectorVersion: "1", payload: { schemaVersion: 1 }, createdAt: at(1), blobs: [] };
    await repository.save(record, context("save-once", 1)); await expect(repository.save(record, context("save-twice", 2))).rejects.toMatchObject({ code: "EVIDENCE_ID_CONFLICT" });
    const approvalsService = new ManageApprovals(new SqliteApprovalRepository(database)); await approvalsService.request({ id: asId("one-shot"), subject: { runId: asId("run") }, kind: "override", context: context("request", 3) }); await approvalsService.decide({ id: asId("one-shot"), decision: "approved", actor: "human", comment: "yes", context: context("decide", 4) }); await expect(approvalsService.decide({ id: asId("one-shot"), decision: "denied", actor: "other", comment: "no", context: context("decide-again", 5) })).rejects.toMatchObject({ code: "APPROVAL_ALREADY_DECIDED" }); expect(database.orm.select().from(approvals).where(eq(approvals.id, "one-shot")).get()).toMatchObject({ state: "approved", decidedBy: "human", decisionComment: "yes" });
    await approvalsService.request({ id: asId("concurrent"), subject: { runId: asId("run") }, kind: "override", context: context("concurrent-request", 6) }); const decisions = await Promise.allSettled([approvalsService.decide({ id: asId("concurrent"), decision: "approved", actor: "a", comment: "yes", context: context("concurrent-a", 7) }), approvalsService.decide({ id: asId("concurrent"), decision: "denied", actor: "b", comment: "no", context: context("concurrent-b", 7) })]); expect(decisions.filter((item) => item.status === "fulfilled")).toHaveLength(1); expect(decisions.filter((item) => item.status === "rejected")).toHaveLength(1);
  });
});
