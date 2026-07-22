import type { Id } from "@nodra/domain";
import type { EvidenceRepository } from "./evidence-model.js";

export class ReadEvidence {
  constructor(private readonly repository: EvidenceRepository) {}
  list(runId: Id) { return this.repository.list(runId); }
  show(evidenceId: Id) { return this.repository.show(evidenceId); }
}
