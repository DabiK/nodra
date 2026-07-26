import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import type { CollectEvidence, ReadEvidence } from "@nodra/application";
import { toId } from "@nodra/application";
import { randomUUID } from "node:crypto";
import { commandContext } from "./command-context.js";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { CollectGitEvidenceDto } from "./dto/evidence.dto.js";
import { CollectCommandEvidenceDto } from "./dto/collect-command-evidence.dto.js";
import { COLLECT_EVIDENCE, READ_EVIDENCE } from "./tokens.js";

@Controller("api")
export class EvidenceController {
  constructor(@Inject(READ_EVIDENCE) private readonly read: ReadEvidence, @Inject(COLLECT_EVIDENCE) private readonly collect: CollectEvidence) {}
  @Get("runs/:id/evidence") list(@Param("id") id: string) { return this.read.list(toId(id)); }
  @Get("evidence/:id") show(@Param("id") id: string) { return this.read.show(toId(id)); }
  @Post("runs/:id/evidence/collect-git") git(@Param("id") id: string, @Body() body: CollectGitEvidenceDto) { return this.collect.gitObservation({ evidenceId: toId(randomUUID()), runId: toId(id), context: commandContext(body.commandId) }); }
  @Post("runs/:id/evidence/collect-command") command(@Param("id") id: string, @Body() body: CollectCommandEvidenceDto) {
    return this.collect.command({ evidenceId: toId(randomUUID()), runId: toId(id), argv: body.argv, cwd: body.cwd, timeoutMs: body.timeoutMs ?? 30_000, maxOutputBytes: body.maxOutputBytes ?? 1_000_000, context: commandContext(body.commandId) });
  }
}
