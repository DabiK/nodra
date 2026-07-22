import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import type { CollectEvidence, ReadEvidence } from "@nodra/application";
import { DomainError, toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import { assertKeys, commandContext, integer, objectBody, requiredString } from "./http-validation.js";
import { COLLECT_EVIDENCE, READ_EVIDENCE } from "./tokens.js";

@Controller("api")
export class EvidenceController {
  constructor(@Inject(READ_EVIDENCE) private readonly read: ReadEvidence, @Inject(COLLECT_EVIDENCE) private readonly collect: CollectEvidence) {}
  @Get("runs/:id/evidence") list(@Param("id") id: string) { return this.read.list(toId(id)); }
  @Get("evidence/:id") show(@Param("id") id: string) { return this.read.show(toId(id)); }
  @Post("runs/:id/evidence/collect-git") git(@Param("id") id: string, @Body() value: unknown) { const body = objectBody(value); assertKeys(body, ["commandId"]); return this.collect.gitObservation({ evidenceId: toId(randomUUID()), runId: toId(id), context: commandContext(body.commandId) }); }
  @Post("runs/:id/evidence/collect-command") command(@Param("id") id: string, @Body() value: unknown) {
    const body = objectBody(value); assertKeys(body, ["argv", "cwd", "timeoutMs", "maxOutputBytes", "commandId"]);
    if (!Array.isArray(body.argv) || !body.argv.every((item) => typeof item === "string")) throw new DomainError("argv must be a string array", "REQUEST_INVALID");
    return this.collect.command({ evidenceId: toId(randomUUID()), runId: toId(id), argv: body.argv as string[], cwd: requiredString(body.cwd, "cwd"), timeoutMs: body.timeoutMs === undefined ? 30_000 : integer(body.timeoutMs, "timeoutMs"), maxOutputBytes: body.maxOutputBytes === undefined ? 1_000_000 : integer(body.maxOutputBytes, "maxOutputBytes"), context: commandContext(body.commandId) });
  }
}
