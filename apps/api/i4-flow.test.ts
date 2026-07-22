import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { NodraSqliteDatabase } from "@nodra/adapters";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { conversations } from "../../packages/adapters/src/sqlite/schema/conversations.js";
import { workspaces } from "../../packages/adapters/src/sqlite/schema/core.js";
import { missions } from "../../packages/adapters/src/sqlite/schema/missions.js";
import { runConfigSnapshots, runs } from "../../packages/adapters/src/sqlite/schema/runs.js";
import { createApp } from "./src/create-app.js";

const exec = promisify(execFile);
describe("I4 API", () => {
  let app: NestExpressApplication; let databaseFile: string; let workspace: string;
  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), "nodra-i4-api-")); databaseFile = join(root, "nodra.db"); workspace = join(root, "workspace");
    await exec("git", ["init", workspace]); await writeFile(join(workspace, "tracked"), "initial"); await exec("git", ["-C", workspace, "add", "tracked"]); await exec("git", ["-C", workspace, "-c", "user.name=Nodra", "-c", "user.email=nodra@local", "commit", "-m", "seed"]);
    app = await createApp({ databaseFile, migrationsDirectory: resolve("packages/adapters/drizzle"), temporalAddress: "127.0.0.1:1" });
    const db = NodraSqliteDatabase.open(databaseFile); const now = new Date().toISOString();
    try {
      db.orm.insert(workspaces).values({ id: "workspace-api-i4", projectId: null, kind: "repo", path: workspace, state: "in_use", createdAt: now }).run();
      db.orm.insert(missions).values({ id: "mission-api-i4", projectId: null, title: "I4 API", executionKind: "agent", state: "ACTIVE", version: 2, createdAt: now, updatedAt: now }).run();
      db.orm.insert(conversations).values({ id: "conversation-api-i4", missionId: "mission-api-i4", managerId: null, providerId: "none", state: "open", createdAt: now }).run();
      db.orm.insert(runs).values({ id: "run-api-i4", missionId: "mission-api-i4", managerId: null, conversationId: "conversation-api-i4", userAttempt: 1, state: "STARTING", temporalWorkflowId: "run/run-api-i4", providerId: "none", modelId: "none", createdAt: now }).run();
      db.orm.insert(runConfigSnapshots).values({ runId: "run-api-i4", resolutionSchemaVersion: 1, providerIdRequested: "none", providerIdResolved: "none", modelIdRequested: "none", modelIdResolved: "none", providerOptionsSchemaVersion: 1, providerOptionsJson: "{}", providerCapabilitiesJson: "{}", promptKind: "mission", promptCompositionSchemaVersion: 1, promptEffective: "", permissionPreset: "read_only", budgetSnapshotJson: "{}", workspaceId: "workspace-api-i4", cwd: workspace, createdAt: now }).run();
    } finally { db.close(); }
  });
  afterEach(async () => app.close());
  it("exposes the complete structured proof and human acceptance flow", async () => {
    const gate = await request(app.getHttpServer()).post("/api/gates").send({ missionId: "mission-api-i4", name: "tests", evaluatorId: "command-exit", evaluatorVersion: "1", criteriaSchemaVersion: 1, criteria: { schemaVersion: 1, expectedExitCode: 0, requiresGit: true }, expectedEvidence: { schemaVersion: 1, kind: "observation", collectorId: "nodra.command", collectorVersion: "1" }, commandId: "api-gate" }).expect(201);
    const bindingId = gate.body.binding.id as string;
    const observation = await request(app.getHttpServer()).post("/api/runs/run-api-i4/evidence/collect-command").send({ argv: [process.execPath, "-e", "process.stdout.write('ok')"], cwd: workspace, timeoutMs: 5000, maxOutputBytes: 1000, commandId: "api-collect" }).expect(201);
    await request(app.getHttpServer()).post(`/api/gates/bindings/${bindingId}/evaluate`).send({ runId: "run-api-i4", evidenceIds: [observation.body.id], commandId: "api-evaluate" }).expect(201).expect(({ body }) => expect(body.rationale).toBe("STRUCTURED_CRITERIA_SATISFIED"));
    await writeFile(join(workspace, "tracked"), "changed"); await request(app.getHttpServer()).post("/api/gates/runs/run-api-i4/refresh-staleness").send({ commandId: "api-stale" }).expect(201).expect(({ body }) => expect(body.stale).toHaveLength(1));
    await request(app.getHttpServer()).post("/api/runs/run-api-i4/delivery/declare").send({ agentDeclaration: "done", observationSummary: "command captured", expectedMissionVersion: 2, commandId: "api-declare" }).expect(201);
    const approval = await request(app.getHttpServer()).post("/api/approvals").send({ subjectType: "run", subjectId: "run-api-i4", kind: "stale-gate-override", commandId: "api-approval" }).expect(201);
    await request(app.getHttpServer()).post(`/api/approvals/${approval.body.id}/decide`).send({ decision: "approved", actor: "human", comment: "reviewed", commandId: "api-decide" }).expect(201);
    const evaluations = await request(app.getHttpServer()).get(`/api/gates/${gate.body.definition.id}/evaluations`).expect(200); const evaluationId = evaluations.body[0].id as string;
    await request(app.getHttpServer()).post(`/api/gates/${evaluationId}/override`).send({ approvalId: approval.body.id, decision: "accept", comment: "human override", commandId: "api-override" }).expect(201);
    await request(app.getHttpServer()).post("/api/runs/run-api-i4/delivery/accept").send({ expectedMissionVersion: 3, comment: "accepted", commandId: "api-accept" }).expect(201).expect(({ body }) => expect(body.resultState).toBe("accepted"));
    await request(app.getHttpServer()).get("/api/runs/run-api-i4/evidence").expect(200).expect(({ body }) => expect(body).toHaveLength(1)); await request(app.getHttpServer()).get("/api/runs/run-api-i4/delivery").expect(200).expect(({ body }) => expect(body.resultState).toBe("accepted"));
  });
  it("strictly rejects shell-shaped argv bodies that are not arrays", async () => { const response = await request(app.getHttpServer()).post("/api/runs/run-api-i4/evidence/collect-command").send({ argv: "echo ok", cwd: workspace, commandId: "invalid" }).expect(400); expect(response.headers["content-type"]).toContain("application/problem+json"); expect(response.body).toMatchObject({ code: "REQUEST_INVALID", commandId: "invalid" }); });
});
